# 🎥 DigitalStage – WebRTC & HLS Streaming Plattform

Ein Diplomarbeitsprojekt zur Entwicklung einer Streaming-Plattform, bei der **Teilnehmer:innen via WebRTC** verbunden werden und der Stream anschließend **per HLS** an viele **Zuschauer:innen** ausgeliefert wird. Zusätzlich wird ein **Live-Chat** sowie ein skalierbarer **Media-Server** implementiert.

---

## 📦 Features

- ✅ WebRTC-Verbindung zwischen Host und Teilnehmern
- ✅ HLS-Streaming für viele Zuschauer
- ✅ Echtzeit-Zuschauerchat (WebSocket-basiert)
- ✅ Medienserver mit ffmpeg-HLS-Transcoding
- ✅ User Authentifizierung & Konferenzverwaltung
- ✅ Dockerized Deployment mit PostgreSQL & Prisma

---

## 🚀 Setup

### 1. Voraussetzungen

- Node.js `>=18`
- Docker & Docker Compose
- PostgreSQL (via Docker)

### 2. .env Datei erstellen

```env
DATABASE_URL=postgresql://digitalstage:digitalStage123@db:5432/digitalstage
JWT_SECRET=your-secret
NEXT_PUBLIC_WS_URL=ws://localhost:3010
