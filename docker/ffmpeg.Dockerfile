# Verwenden eines stabilen, schlanken Images mit vorinstalliertem FFmpeg
FROM jrottenberg/ffmpeg:4.4-alpine

# Erstelle das Verzeichnis, in das FFmpeg die HLS-Dateien schreiben wird.
# Dies entspricht dem Mount-Punkt, den wir später im docker-compose verwenden werden.
# Wir nehmen /mnt/hls_output als Zielpfad.
RUN mkdir -p /mnt/hls_output

# Setze das Arbeitsverzeichnis
WORKDIR /mnt/hls_output

# Optional: Setze den Standard-Befehl auf "sleep infinity",
# damit der Container im Falle eines fehlenden command: in docker-compose nicht sofort beendet wird.
# Das eigentliche FFmpeg-Kommando wird später über docker-compose überschrieben.
CMD ["sleep", "infinity"]