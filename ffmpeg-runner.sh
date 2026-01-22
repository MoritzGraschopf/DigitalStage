#!/usr/bin/env bash
set -euo pipefail

SDP="/opt/digitalstage/sdp/input.sdp"
HLS="/opt/digitalstage/hls"
ACTIVE="/opt/digitalstage/sdp/active"


ACTIVE_STALE_SEC=10          # wenn active älter als X sec -> conference gilt als tot
FIRST_OUTPUT_DEADLINE=60     # wenn nach X sec gar nichts im HLS-Ordner landet -> restart
WARMUP_SEC=25                # in den ersten X sec kein Stall-Check (Startup/Keyframes)
STALL_AFTER_SEC=15           # wenn nach Warmup X sec kein HLS-Write mehr -> restart
CHECK_INTERVAL_SEC=1

# HLS Verhalten (für Stabilität + spätere MP4-Konvertierung)
HLS_TIME=1
HLS_LIST_SIZE=8 # 2 ist viel zu knapp, 6-10 ist realistisch
HLS_FLAGS="independent_segments+temp_file"
# Optional später, wenn alles stabil ist:
# HLS_FLAGS="delete_segments+independent_segments+temp_file"

SESSION_FLAG="$HLS/.session_active"

mkdir -p "$HLS"

log() { echo "[ffmpeg-runner] $*"; }

active_is_stale() {
  [ ! -f "$ACTIVE" ] && return 0
  local now ts age
  now=$(date +%s)
  ts=$(stat -c %Y "$ACTIVE" 2>/dev/null || echo 0)
  age=$(( now - ts ))
  [ "$age" -gt "$ACTIVE_STALE_SEC" ]
}

has_any_hls_files() {
  find "$HLS" -maxdepth 1 -type f \
    \( -name "*.m3u8" -o -name "*.m3u8.tmp" -o -name "*.ts" -o -name "*.ts.tmp" \) \
    -print -quit 2>/dev/null | grep -q .
}

# Neu: age pro stream-prefix (screen/presenter/questioner/organizer)
latest_age_for_prefix() {
  local prefix="$1" now ts epoch
  now=$(date +%s)

  ts=$(find "$HLS" -maxdepth 1 -type f \
      \( -name "${prefix}.m3u8" -o -name "${prefix}.m3u8.tmp" -o -name "${prefix}_*.ts" -o -name "${prefix}_*.ts.tmp" \) \
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
    -reorder_queue_size 1024 \
    -rtbufsize 500M \
    -max_delay 2000000 \
    -fflags +genpts+discardcorrupt \
    -analyzeduration 1M -probesize 1M \
    -i "$SDP" \
    \
    -map 0:v:0? -map 0:a:0? \
    -vsync 0 \
    -vf "scale=w=1920:h=1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v 6000k -maxrate 8000k -bufsize 24000k \
    -g 15 -keyint_min 15 -sc_threshold 0 -bf 0 \
    -force_key_frames "expr:gte(t,n_forced*1)" \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time "$HLS_TIME" -hls_list_size "$HLS_LIST_SIZE" \
    -hls_flags "$HLS_FLAGS" -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/screen_%05d.ts" "$HLS/screen.m3u8" \
    \
    -map 0:v:1? -map 0:a:1? \
    -vsync 0 \
    -vf "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v 2500k -maxrate 3500k -bufsize 10500k \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
    -force_key_frames "expr:gte(t,n_forced*1)" \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time "$HLS_TIME" -hls_list_size "$HLS_LIST_SIZE" \
    -hls_flags "$HLS_FLAGS" -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/presenter_%05d.ts" "$HLS/presenter.m3u8" \
    \
    -map 0:v:2? -map 0:a:2? \
    -vsync 0 \
    -vf "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v 2500k -maxrate 3500k -bufsize 10500k \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
    -force_key_frames "expr:gte(t,n_forced*1)" \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time "$HLS_TIME" -hls_list_size "$HLS_LIST_SIZE" \
    -hls_flags "$HLS_FLAGS" -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/questioner_%05d.ts" "$HLS/questioner.m3u8" \
    \
    -map 0:v:3? -map 0:a:3? \
    -vsync 0 \
    -vf "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v 2500k -maxrate 3500k -bufsize 10500k \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 \
    -force_key_frames "expr:gte(t,n_forced*1)" \
    -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time "$HLS_TIME" -hls_list_size "$HLS_LIST_SIZE" \
    -hls_flags "$HLS_FLAGS" -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/organizer_%05d.ts" "$HLS/organizer.m3u8" \
    &

  echo $!
}

while true; do
  # Nur starten wenn conference aktiv + SDP vorhanden
  until [ -s "$SDP" ] && [ -f "$ACTIVE" ] && ! active_is_stale; do
    log "waiting for active conference + sdp..."
    rm -f "$SESSION_FLAG" 2>/dev/null || true
    sleep 0.5
  done

  # NICHT mehr automatisch clearen (wichtig für Stabilität & spätere MP4-Konvertierung)
  touch "$SESSION_FLAG" 2>/dev/null || true

  PID="$(start_ffmpeg)"
  STARTED_AT="$(date +%s)"
  log "ffmpeg pid=$PID"

  while kill -0 "$PID" 2>/dev/null; do
    if active_is_stale; then
      log "conference inactive -> stopping ffmpeg"
      kill_ffmpeg "$PID"
      rm -f "$SESSION_FLAG" 2>/dev/null || true
      break
    fi

    uptime=$(( $(date +%s) - STARTED_AT ))

    # Noch kein Output?
    if ! has_any_hls_files; then
      if [ "$uptime" -gt "$FIRST_OUTPUT_DEADLINE" ]; then
        log "no HLS output after ${FIRST_OUTPUT_DEADLINE}s -> restarting ffmpeg"
        kill_ffmpeg "$PID"
        break
      fi
      sleep "$CHECK_INTERVAL_SEC"
      continue
    fi

    # Warmup: keine Stall-Checks
    if [ "$uptime" -lt "$WARMUP_SEC" ]; then
      sleep "$CHECK_INTERVAL_SEC"
      continue
    fi

    # ✅ Neu: Stall-Check pro Playlist/Prefix
    for p in screen presenter questioner organizer; do
      age="$(latest_age_for_prefix "$p")"
      if [ "$age" -gt "$STALL_AFTER_SEC" ]; then
        log "$p stalled (${age}s) -> restarting ffmpeg"
        kill_ffmpeg "$PID"
        break 2
      fi
    done

    sleep "$CHECK_INTERVAL_SEC"
  done

  log "loop restart in 1s..."
  sleep 1
done
