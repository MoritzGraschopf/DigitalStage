#!/usr/bin/env bash
set -euo pipefail

SDP="/opt/digitalstage/sdp/input.sdp"
HLS="/opt/digitalstage/hls"
ACTIVE="/opt/digitalstage/sdp/active"

# Tuning
ACTIVE_STALE_SEC=8          # wenn active älter als X sec -> conference gilt als tot
FIRST_OUTPUT_DEADLINE=45    # wenn nach X sec noch nie eine HLS-Datei geschrieben wurde -> restart
WARMUP_SEC=20               # nach Start: in den ersten X sec kein stall-check (wenn schon Output kommt egal)
STALL_AFTER_SEC=8           # wenn nach Warmup für X sec kein HLS-Write mehr -> restart
CHECK_INTERVAL_SEC=1

SESSION_FLAG="$HLS/.live_cleaned"

mkdir -p "$HLS"

log() {
  echo "[ffmpeg-runner] $*"
}

active_is_stale() {
  # file fehlt => stale (Konferenz nicht aktiv)
  [ ! -f "$ACTIVE" ] && return 0
  local now ts age
  now=$(date +%s)
  ts=$(stat -c %Y "$ACTIVE" 2>/dev/null || echo 0)
  age=$(( now - ts ))
  [ "$age" -gt "$ACTIVE_STALE_SEC" ]
}

has_any_hls_files() {
  find "$HLS" -maxdepth 1 -type f \
    \( -name "*.m3u8" -o -name "*.m3u8.tmp" -o -name "*.ts" \) \
    -print -quit 2>/dev/null | grep -q .
}

latest_hls_age() {
  # liefert Alter in Sekunden der zuletzt angefassten HLS-Datei (m3u8/tmp/ts)
  local now ts epoch
  now=$(date +%s)

  ts=$(find "$HLS" -maxdepth 1 -type f \
      \( -name "*.m3u8" -o -name "*.m3u8.tmp" -o -name "*.ts" \) \
      -printf '%T@\n' 2>/dev/null | sort -nr | head -n1 || true)

  if [ -z "${ts:-}" ]; then
    echo 999
    return 0
  fi

  epoch="${ts%.*}"
  echo $(( now - epoch ))
}

kill_ffmpeg() {
  local pid="$1"
  log "stopping ffmpeg (pid=$pid)..."
  kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

start_ffmpeg() {
  log "starting ffmpeg..."
  ffmpeg -hide_banner -loglevel info -stats \
    -protocol_whitelist file,udp,rtp \
    -analyzeduration 0 -probesize 64k \
    -fflags +nobuffer+discardcorrupt -flags low_delay \
    -max_delay 0 \
    -i "$SDP" \
    \
    -map 0:v:0? -map 0:a:0? \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/screen_%05d.ts" "$HLS/screen.m3u8" \
    \
    -map 0:v:1? -map 0:a:1? \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/presenter_%05d.ts" "$HLS/presenter.m3u8" \
    \
    -map 0:v:2? -map 0:a:2? \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/questioner_%05d.ts" "$HLS/questioner.m3u8" \
    \
    -map 0:v:3? -map 0:a:3? \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/organizer_%05d.ts" "$HLS/organizer.m3u8" \
    &
  echo $!
}

while true; do
  # Nur starten, wenn Konferenz aktiv + SDP vorhanden
  until [ -s "$SDP" ] && [ -f "$ACTIVE" ] && ! active_is_stale; do
    log "waiting for active conference + sdp..."
    sleep 0.5
  done

  # HLS nur 1x pro Session löschen (nicht bei jedem Restart)
  if [ ! -f "$SESSION_FLAG" ]; then
    log "cleaning HLS directory (once per session)..."
    rm -f "$HLS"/*.ts "$HLS"/*.m3u8 "$HLS"/*.m3u8.tmp 2>/dev/null || true
    touch "$SESSION_FLAG" || true
  fi

  PID="$(start_ffmpeg)"
  STARTED_AT="$(date +%s)"
  log "ffmpeg pid=$PID"

  # Watchdog Loop
  while kill -0 "$PID" 2>/dev/null; do
    # Conference tot?
    if active_is_stale; then
      log "conference inactive -> stopping ffmpeg"
      kill_ffmpeg "$PID"
      rm -f "$SESSION_FLAG" 2>/dev/null || true
      break
    fi

    uptime=$(( $(date +%s) - STARTED_AT ))

    # Noch gar kein Output? -> nicht sofort killen, sondern Deadline abwarten
    if ! has_any_hls_files; then
      if [ "$uptime" -gt "$FIRST_OUTPUT_DEADLINE" ]; then
        log "no HLS output after ${FIRST_OUTPUT_DEADLINE}s -> restarting ffmpeg"
        kill_ffmpeg "$PID"
      fi
      sleep "$CHECK_INTERVAL_SEC"
      continue
    fi

    # Warmup-Phase: nicht aggressiv
    if [ "$uptime" -lt "$WARMUP_SEC" ]; then
      sleep "$CHECK_INTERVAL_SEC"
      continue
    fi

    age="$(latest_hls_age)"
    if [ "$age" -gt "$STALL_AFTER_SEC" ]; then
      log "HLS stalled (${age}s) -> restarting ffmpeg"
      kill_ffmpeg "$PID"
      break
    fi

    sleep "$CHECK_INTERVAL_SEC"
  done

  log "loop restart in 1s..."
  sleep 1
done
