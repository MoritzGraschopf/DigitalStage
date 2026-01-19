#!/usr/bin/env bash
set -euo pipefail

SDP="/opt/digitalstage/sdp/input.sdp"
HLS="/opt/digitalstage/hls"
ACTIVE="/opt/digitalstage/sdp/active"   # <- wird vom ws-server getoucht

mkdir -p "$HLS"

active_is_stale() {
  [ ! -f "$ACTIVE" ] && return 0
  local now ts age
  now=$(date +%s)
  ts=$(stat -c %Y "$ACTIVE" 2>/dev/null || echo 0)
  age=$(( now - ts ))
  [ "$age" -gt 8 ]   # 8s ohne heartbeat = "Konferenz tot"
}

latest_ts_age() {
  local f now ts
  f=$(ls -1t "$HLS"/*.ts 2>/dev/null | head -n1 || true)
  [ -z "$f" ] && echo 999 && return 0
  now=$(date +%s)
  ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
  echo $(( now - ts ))
}

while true; do
  # nur starten, wenn Konferenz "aktiv" ist und SDP existiert
  until [ -s "$SDP" ] && [ -f "$ACTIVE" ]; do
    echo "[ffmpeg-runner] waiting for active conference + sdp..."
    sleep 0.5
  done

  echo "[ffmpeg-runner] cleaning HLS directory..."
  rm -f "$HLS"/*.ts "$HLS"/*.m3u8 2>/dev/null || true

  echo "[ffmpeg-runner] starting ffmpeg..."
  ffmpeg -hide_banner -loglevel info -stats \
    -protocol_whitelist file,udp,rtp \
    -analyzeduration 0 -probesize 64k \
    -fflags +nobuffer+discardcorrupt -flags low_delay \
    -max_delay 0 \
    -i "$SDP" \
    \
    -map 0:v:0? -map 0:a:0? -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/screen_%05d.ts" "$HLS/screen.m3u8" \
    \
    -map 0:v:1? -map 0:a:1? -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/presenter_%05d.ts" "$HLS/presenter.m3u8" \
    \
    -map 0:v:2? -map 0:a:2? -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/questioner_%05d.ts" "$HLS/questioner.m3u8" \
    \
    -map 0:v:3? -map 0:a:3? -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 0 -c:a aac -b:a 96k -ar 48000 \
    -f hls -hls_time 1 -hls_list_size 2 \
    -hls_flags delete_segments+independent_segments+temp_file \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/organizer_%05d.ts" "$HLS/organizer.m3u8" \
    &

  PID=$!
  echo "[ffmpeg-runner] ffmpeg pid=$PID"

  # Watchdog: stop wenn Konferenz tot ODER HLS stuck
  while kill -0 "$PID" 2>/dev/null; do
    if active_is_stale; then
      echo "[ffmpeg-runner] conference inactive -> stopping ffmpeg"
      kill -TERM "$PID" 2>/dev/null || true
      sleep 1
      kill -KILL "$PID" 2>/dev/null || true
      wait "$PID" 2>/dev/null || true
      break
    fi

    age=$(latest_ts_age)
    if [ "$age" -gt 6 ]; then
      echo "[ffmpeg-runner] HLS stalled (${age}s) -> restarting ffmpeg"
      kill -TERM "$PID" 2>/dev/null || true
      sleep 1
      kill -KILL "$PID" 2>/dev/null || true
      wait "$PID" 2>/dev/null || true
      break
    fi

    sleep 1
  done

  echo "[ffmpeg-runner] loop restart in 1s..."
  sleep 1
done
