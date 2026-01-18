#!/usr/bin/env bash
set -eu

SDP="/opt/digitalstage/sdp/input.sdp"
HLS="/opt/digitalstage/hls"

mkdir -p "$HLS"

while true; do
  until [ -s "$SDP" ]; do
    echo "[ffmpeg-runner] waiting for sdp: $SDP"
    sleep 0.5
  done

  # HLS-Ordner vor jedem Start löschen, um Segment-Kollisionen zu vermeiden
  echo "[ffmpeg-runner] cleaning HLS directory..."
  rm -f "$HLS"/*.ts "$HLS"/*.m3u8 2>/dev/null || true

  echo "[ffmpeg-runner] starting ffmpeg..."
  ffmpeg -hide_banner -loglevel info -stats \
    -protocol_whitelist file,udp,rtp \
    -analyzeduration 10M -probesize 10M \
    -fflags nobuffer -flags low_delay \
    -i "$SDP" \
    \
    -map 0:v:0? -map 0:a:0? \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -force_key_frames "expr:gte(t,n_forced*2)" \
    -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 48000 \
    -f hls -hls_time 2 -hls_list_size 3 \
    -hls_flags delete_segments+independent_segments \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/screen_%05d.ts" "$HLS/screen.m3u8" \
    \
    -map 0:v:1? -map 0:a:1? \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -force_key_frames "expr:gte(t,n_forced*2)" \
    -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 48000 \
    -f hls -hls_time 2 -hls_list_size 3 \
    -hls_flags delete_segments+independent_segments \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/presenter_%05d.ts" "$HLS/presenter.m3u8" \
    \
    -map 0:v:2? -map 0:a:2? \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -force_key_frames "expr:gte(t,n_forced*2)" \
    -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 48000 \
    -f hls -hls_time 2 -hls_list_size 3 \
    -hls_flags delete_segments+independent_segments \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/questioner_%05d.ts" "$HLS/questioner.m3u8" \
    \
    -map 0:v:3? -map 0:a:3? \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -force_key_frames "expr:gte(t,n_forced*2)" \
    -g 60 -keyint_min 60 -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 48000 \
    -f hls -hls_time 2 -hls_list_size 3 \
    -hls_flags delete_segments+independent_segments \
    -hls_start_number_source epoch \
    -hls_segment_filename "$HLS/organizer_%05d.ts" "$HLS/organizer.m3u8" \
  || true

  echo "[ffmpeg-runner] ffmpeg exited, restarting in 1s..."
  sleep 1
done
