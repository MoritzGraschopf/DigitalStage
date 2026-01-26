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

# HLS Verhalten
HLS_TIME=6
HLS_LIST_SIZE=20
HLS_FLAGS="delete_segments+append_list+independent_segments+program_date_time+omit_endlist+temp_file"
# Für MP4 später eher:
# HLS_FLAGS="append_list+independent_segments+program_date_time+omit_endlist+temp_file"

SESSION_FLAG="$HLS/.session_active"
mkdir -p "$HLS"

log() { echo "[ffmpeg-runner] $*"; }

mtime() {
  # Linux: stat -c %Y, macOS/BSD: stat -f %m
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

active_is_stale() {
  [ ! -f "$ACTIVE" ] && return 0
  local now ts age
  now=$(date +%s)
  ts="$(mtime "$ACTIVE")"
  age=$(( now - ts ))
  [ "$age" -gt "$ACTIVE_STALE_SEC" ]
}

has_any_hls_files() {
  find "$HLS" -maxdepth 1 -type f \
    \( -name "*.m3u8" -o -name "*.m3u8.tmp" -o -name "*.ts" -o -name "*.ts.tmp" \) \
    -print -quit 2>/dev/null | grep -q .
}

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

# Wird pro Lauf gesetzt (nur Prefixes, die FFmpeg auch wirklich startet)
PREFIXES_TO_CHECK=()

start_ffmpeg() {
  log "starting ffmpeg..."

  # Stabilität/CPU: 30fps, feste GOP passend zu HLS_TIME
  local FPS=30
  local GOP=$((FPS * HLS_TIME))   # 6s * 30fps = 180

  # Wie viele Video-Medias stehen im SDP?
  # (Zählt die m=video Sektionen, das matcht i.d.R. mit 0:v:0..n)
  local VIDEO_COUNT
  VIDEO_COUNT=$(grep -c '^m=video' "$SDP" 2>/dev/null || echo 0)

  PREFIXES_TO_CHECK=()

  # Bauen wir den Befehl als Array -> kein Backslash-Horror
  local -a cmd
  cmd=(
    ffmpeg
    -hide_banner -loglevel info -stats
    -protocol_whitelist file,udp,rtp

    # RTP/UDP Robustheit
    -reorder_queue_size 1024
    -rtbufsize 500M
    -max_delay 3000000

    # weniger Müll / bessere Zeitstempel
    -fflags +genpts+discardcorrupt
    -analyzeduration 1M -probesize 1M

    -i "$SDP"
  )

  add_variant() {
    local prefix="$1" v_idx="$2" a_idx="$3"
    local w="$4" h="$5"
    local vb="$6" vmax="$7" vbuf="$8"

    PREFIXES_TO_CHECK+=("$prefix")

    cmd+=(
      -map "0:v:${v_idx}?" -map "0:a:${a_idx}?"
      -fps_mode cfr -r "$FPS"
      -vf "scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2"

      -c:v libx264 -preset veryfast -pix_fmt yuv420p
      -b:v "$vb" -maxrate "$vmax" -bufsize "$vbuf"

      # saubere Segment-Keyframes:
      -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 -bf 0
      -force_key_frames "expr:gte(t,n_forced*${HLS_TIME})"

      # Audio pro Stream (optional gemappt, wenn nicht vorhanden -> video-only ok)
      -c:a aac -b:a 96k -ar 48000 -ac 2

      -f hls
      -hls_time "$HLS_TIME"
      -hls_list_size "$HLS_LIST_SIZE"
      -hls_flags "$HLS_FLAGS"
      -hls_start_number_source epoch
      -hls_segment_filename "$HLS/${prefix}_%05d.ts"
      "$HLS/${prefix}.m3u8"
    )
  }

  # Nur Outputs hinzufügen, wenn das SDP den Video-Stream dafür hat
  # Index 0..3 => screen/presenter/questioner/organizer
  if [ "$VIDEO_COUNT" -ge 1 ]; then
    # Screen 1080p (stabiler Bereich, nicht absurd hoch)
    add_variant "screen" 0 0 1920 1080 6000k 8000k 24000k
  fi
  if [ "$VIDEO_COUNT" -ge 2 ]; then
    add_variant "presenter" 1 1 1280 720 3000k 4500k 13500k
  fi
  if [ "$VIDEO_COUNT" -ge 3 ]; then
    add_variant "questioner" 2 2 1280 720 3000k 4500k 13500k
  fi
  if [ "$VIDEO_COUNT" -ge 4 ]; then
    add_variant "organizer" 3 3 1280 720 3000k 4500k 13500k
  fi

  if [ "${#PREFIXES_TO_CHECK[@]}" -eq 0 ]; then
    log "no video streams in SDP -> not starting ffmpeg"
    return 1
  fi

  "${cmd[@]}" &
  echo $!
}

while true; do
  # Nur starten wenn conference aktiv + SDP vorhanden
  until [ -s "$SDP" ] && [ -f "$ACTIVE" ] && ! active_is_stale; do
    log "waiting for active conference + sdp..."
    rm -f "$SESSION_FLAG" 2>/dev/null || true
    sleep 0.5
  done

  touch "$SESSION_FLAG" 2>/dev/null || true

  PID="$(start_ffmpeg)" || { sleep 1; continue; }
  STARTED_AT="$(date +%s)"
  SDP_MTIME="$(mtime "$SDP")"
  log "ffmpeg pid=$PID (outputs: ${PREFIXES_TO_CHECK[*]})"

  while kill -0 "$PID" 2>/dev/null; do
    if active_is_stale; then
      log "conference inactive -> stopping ffmpeg"
      kill_ffmpeg "$PID"
      rm -f "$SESSION_FLAG" 2>/dev/null || true
      break
    fi

    new_mtime="$(mtime "$SDP")"
    if [ "$new_mtime" != "$SDP_MTIME" ]; then
      log "SDP changed -> restarting ffmpeg to pick up new streams"
      kill_ffmpeg "$PID"
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

    # Stall-Check nur für gestartete Prefixes
    for p in "${PREFIXES_TO_CHECK[@]}"; do
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
