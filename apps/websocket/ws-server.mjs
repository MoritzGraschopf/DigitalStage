import { WebSocketServer } from "ws";
import http from "http";
import fs from "fs";
import path from "path";
import dns from "dns";
import { promisify } from "util";

const dnsLookup = promisify(dns.lookup);

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const mediasoup = require("mediasoup");

const wsServer = http.createServer();
const wss = new WebSocketServer({ server: wsServer });

const inConference = new Map();
const notInConference = new Map();

const rtcRooms = new Map();

// HLS Ingest State pro Conference
const hlsIngest = new Map(); // conferenceId -> { transports, consumers, activeAudioUserId }

const WS = { OPEN: 1 };
function now() { return Date.now(); }

let worker;

const mediaCodecs = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {}
    }
];

async function getOrCreateRoom(confId) {
    if (rtcRooms.has(confId)) return rtcRooms.get(confId);

    const router = await worker.createRouter({ mediaCodecs });
    const room = {
        router,
        peers: new Map(), // userId -> PeerState
    };
    rtcRooms.set(confId, room);
    return room;
}

function getPeer(room, userId) {
    if (!room.peers.has(userId)) {
        room.peers.set(userId, {
            ws: null,
            transports: new Map(), // id -> transport
            producers: new Map(),  // id -> producer
            consumers: new Map(),  // id -> consumer
            role: "PARTICIPANT",
        });
    }
    return room.peers.get(userId);
}

function safeSend(ws, obj) {
    if (ws && ws.readyState === WS.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastRoom(confId, exceptUserId, payload) {
    const room = rtcRooms.get(confId);
    if (!room) return;

    for (const [uid, peer] of room.peers.entries()) {
        if (uid === exceptUserId) continue;
        if (peer.ws) safeSend(peer.ws, payload);
    }
}

async function cleanupPeer(confId, userId) {
    const room = rtcRooms.get(confId);
    if (!room) return;

    const peer = room.peers.get(userId);
    if (!peer) return;

    for (const c of peer.consumers.values()) {
        try { c.close(); } catch {}
    }
    peer.consumers.clear();

    for (const p of peer.producers.values()) {
        try { p.close(); } catch {}
        broadcastRoom(confId, userId, { type: "sfu:producer-closed", userId, producerId: p.id });
    }
    peer.producers.clear();

    for (const t of peer.transports.values()) {
        try { t.close(); } catch {}
    }
    peer.transports.clear();

    room.peers.delete(userId);
    broadcastRoom(confId, userId, { type: "sfu:peer-left", userId });

    if (room.peers.size === 0) {
        try { room.router.close(); } catch {}
        rtcRooms.delete(confId);
    }
}

/* =========================
   ✅ NEW: request/response helpers
   ========================= */
function respond(ws, requestId, data = null) { // ✅ NEW
    safeSend(ws, { type: "sfu:response", responseId: requestId, ok: true, data });
}
function respondError(ws, requestId, error) { // ✅ NEW
    safeSend(ws, { type: "sfu:response", responseId: requestId, ok: false, error: String(error || "error") });
}

// =========================
// HLS Helper Functions
// =========================

async function ensureDir(p) {
    await fs.promises.mkdir(p, { recursive: true });
}

function writeSdp(filePath, videoSizes = { cam: null, screen: null }) {
    // Standard-Video-Größe, falls nicht angegeben (1280x720)
    const camSize = videoSizes.cam || "1280x720";
    const screenSize = videoSizes.screen || "1920x1080";
    
    const [camWidth, camHeight] = camSize.split("x");
    const [screenWidth, screenHeight] = screenSize.split("x");
    
    const sdp = `v=0
        o=- 0 0 IN IP4 0.0.0.0
        s=DigitalStage
        c=IN IP4 0.0.0.0
        t=0 0
        
        m=video 5004 RTP/AVP 96
        a=rtpmap:96 VP8/90000
        a=fmtp:96 max-fr=30;max-fs=3600
        a=framerate:30
        a=video_size:${camWidth}x${camHeight}
        a=recvonly
        
        m=video 5006 RTP/AVP 97
        a=rtpmap:97 VP8/90000
        a=fmtp:97 max-fr=30;max-fs=3600
        a=framerate:30
        a=video_size:${screenWidth}x${screenHeight}
        a=recvonly
        
        m=audio 5008 RTP/AVP 111
        a=rtpmap:111 OPUS/48000/2
        a=recvonly
        `;
    fs.writeFileSync(filePath, sdp);
}

async function createPlainOut(router, { ip, port, rtcpPort }) {
    const transport = await router.createPlainTransport({
        listenIp: { ip: "0.0.0.0", announcedIp: null },
        rtcpMux: false,
        comedia: true,
    });
    // Verbinde den PlainTransport mit FFmpeg
    await transport.connect({ ip, port, rtcpPort });
    return transport;
}

async function startHlsForConference(conferenceId, router) {
    if (hlsIngest.has(conferenceId)) return hlsIngest.get(conferenceId);

    // Ordner (server-bind mount) müssen existieren, sonst failt ffmpeg beim Schreiben
    await ensureDir(`/hls/${conferenceId}/cam`);
    await ensureDir(`/hls/${conferenceId}/screen`);
    await ensureDir(`/hls/${conferenceId}/audio`);

    // SDP schreiben (wichtig: der ffmpeg container liest /sdp/input.sdp)
    // Initial mit Standard-Größen, wird später aktualisiert wenn Producer hinzugefügt werden
    writeSdp(`/sdp/input.sdp`);

    // DNS-Lookup für FFmpeg-Container (mit Fallback)
    const ffmpegHostname = process.env.FFMPEG_HOST || "ffmpeg";
    let targetIp;
    try {
        const result = await dnsLookup(ffmpegHostname);
        targetIp = result.address;
        console.log(`✅ Resolved ${ffmpegHostname} to IP: ${targetIp}`);
    } catch (err) {
        console.error(`❌ Failed to resolve ${ffmpegHostname}, using fallback IP`);
        targetIp = process.env.FFMPEG_IP || "127.0.0.1";
    }

    // Separaten Router für FFmpeg erstellen (für PipeTransport)
    const ffmpegRouter = await worker.createRouter({ mediaCodecs });

    // PipeTransport auf dem Haupt-Router erstellen
    const pipeTransport = await router.createPipeTransport({
        listenIp: { ip: "127.0.0.1", announcedIp: null },
        enableSctp: false,
    });

    // PipeTransport auf dem FFmpeg-Router erstellen
    const ffmpegPipeTransport = await ffmpegRouter.createPipeTransport({
        listenIp: { ip: "127.0.0.1", announcedIp: null },
        enableSctp: false,
    });

    // Die beiden PipeTransports verbinden
    await pipeTransport.connect({
        ip: ffmpegPipeTransport.tuple.localIp,
        port: ffmpegPipeTransport.tuple.localPort,
    });

    await ffmpegPipeTransport.connect({
        ip: pipeTransport.tuple.localIp,
        port: pipeTransport.tuple.localPort,
    });

    // PlainTransports auf dem FFmpeg-Router erstellen
    const transports = {
        cam: await createPlainOut(ffmpegRouter, { ip: targetIp, port: 5004, rtcpPort: 5005 }),
        screen: await createPlainOut(ffmpegRouter, { ip: targetIp, port: 5006, rtcpPort: 5007 }),
        audio: await createPlainOut(ffmpegRouter, { ip: targetIp, port: 5008, rtcpPort: 5009 }),
    };

    const state = { 
        router: ffmpegRouter,
        pipeTransport,
        ffmpegPipeTransport,
        transports, 
        consumers: { cam: null, screen: null, audio: null }, 
        activeAudioUserId: null,
        videoSizes: { cam: null, screen: null }
    };
    hlsIngest.set(conferenceId, state);
    return state;
}

function sanitizeRtpParameters(rtpParameters) {
    return {
        codecs: rtpParameters.codecs.filter(c =>
            c.mimeType.toLowerCase() === "video/vp8" ||
            c.mimeType.toLowerCase() === "audio/opus"
        ),
        encodings: [
            {
                ssrc: rtpParameters.encodings[0].ssrc
            }
        ],
        headerExtensions: [], // 🔥 WICHTIG
        rtcp: {
            cname: rtpParameters.rtcp?.cname,
            reducedSize: true,
            mux: false
        }
    };
}


async function attachProducerToHls(conferenceId, router, producer, tag, userId) {
    const ingest = await startHlsForConference(conferenceId, router);

    // schon belegt? (bei 1 conference test: überschreiben/neu setzen)
    if (ingest.consumers[tag]) {
        try {
            const oldConsumer = ingest.consumers[tag];
            if (oldConsumer?.consumer) oldConsumer.consumer.close();
            if (oldConsumer?.tempTransport) oldConsumer.tempTransport.close();
            if (oldConsumer?.pipeProducer) oldConsumer.pipeProducer.close();
            if (oldConsumer?.pipeConsumer) oldConsumer.pipeConsumer.close();
            if (oldConsumer?.plainProducer) oldConsumer.plainProducer.close();
            if (oldConsumer?.ffmpegTempTransport) oldConsumer.ffmpegTempTransport.close();
        } catch {}
        ingest.consumers[tag] = null;
    }

    const plainTransport = ingest.transports[tag];
    const pipeTransport = ingest.pipeTransport;
    const ffmpegPipeTransport = ingest.ffmpegPipeTransport;
    const ffmpegRouter = ingest.router;

    // Um einen Consumer zu erstellen, brauchen wir einen Transport
    // Wir erstellen einen temporären WebRTC-Transport für den Consumer
    const tempTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: "127.0.0.1", announcedIp: null }],
        enableUdp: false,
        enableTcp: true,
    });

    // Consumer vom Router erstellen (über den temporären Transport)
    // Dieser Consumer empfängt die Pakete vom Producer
    const consumer = await tempTransport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: false,
    });

    // Video-Größe aus RTP-Parametern extrahieren (falls vorhanden)
    if (consumer.kind === "video" && consumer.rtpParameters.encodings?.[0]) {
        const encoding = consumer.rtpParameters.encodings[0];
        // Versuche Video-Größe aus encoding zu extrahieren oder verwende Standard
        let videoSize = null;
        if (encoding.scaleResolutionDownBy) {
            // Wenn scaleResolutionDownBy vorhanden, können wir die ursprüngliche Größe schätzen
            // Standard: 1280x720 für cam, 1920x1080 für screen
            videoSize = tag === "screen" ? "1920x1080" : "1280x720";
        } else {
            videoSize = tag === "screen" ? "1920x1080" : "1280x720";
        }
        
        // SDP-File mit Video-Größe aktualisieren
        const currentSizes = ingest.videoSizes || { cam: null, screen: null };
        currentSizes[tag] = videoSize;
        ingest.videoSizes = currentSizes;
        writeSdp(`/sdp/input.sdp`, currentSizes);
    }

    // Producer auf dem PipeTransport erstellen (leitet Pakete zum FFmpeg-Router weiter)
    const pipeProducer = await pipeTransport.produce({
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
    });

    // Consumer auf dem FFmpeg-Router erstellen (empfängt Pakete vom PipeProducer)
    // Wir brauchen einen Transport auf dem FFmpeg-Router für den Consumer
    const ffmpegTempTransport = await ffmpegRouter.createWebRtcTransport({
        listenIps: [{ ip: "127.0.0.1", announcedIp: null }],
        enableUdp: false,
        enableTcp: true,
    });

    const pipeConsumer = await ffmpegTempTransport.consume({
        producerId: pipeProducer.id,
        rtpCapabilities: ffmpegRouter.rtpCapabilities,
        paused: false,
    });

    // Producer auf dem PlainTransport erstellen (sendet Pakete an FFmpeg)
    const plainProducer = await plainTransport.produce({
        kind: pipeConsumer.kind,
        rtpParameters: sanitizeRtpParameters(pipeConsumer.rtpParameters)
    });

    // Alle Objekte behalten
    ingest.consumers[tag] = { consumer, pipeProducer, pipeConsumer, plainProducer, tempTransport, ffmpegTempTransport };

    consumer.on("transportclose", () => {
        if (ingest.consumers[tag]) ingest.consumers[tag] = null;
    });
    producer.on("transportclose", () => {
        if (ingest.consumers[tag]) ingest.consumers[tag] = null;
    });

    // Audio-Owner merken (optional)
    if (tag === "audio") ingest.activeAudioUserId = userId;
}

// ✅ CHANGED: Transport helper (ANNOUNCED_IP matcht .env)
async function createWebRtcTransport(router) {
    const transport = await router.createWebRtcTransport({
        listenIps: [
            {
                ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
                announcedIp: process.env.ANNOUNCED_IP || process.env.MEDIASOUP_ANNOUNCED_IP || null, // ✅ CHANGED
            },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1_000_000,
    });

    return transport;
}

(async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT || 40000),
        rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT || 49999),
        logLevel: "debug",
        logTags: [
            "info",
            "ice",
            "dtls",
            "rtp",
            "srtp",
            "rtcp",
            "bwe",
            "score",
            "simulcast",
            "svc"
        ],
    });

    worker.on("died", () => {
        console.error("mediasoup worker died, exiting...");
        process.exit(1);
    });

    console.log("✅ mediasoup worker ready");
})();

wss.on("connection", (ws) => {
    console.log("🔌 Client connected");

    ws.isAlive = true;
    ws.lastPong = now();
    ws.on("pong", () => {
        ws.isAlive = true;
        ws.lastPong = now();
    });

    const hb = setInterval(() => {
        if (!ws.isAlive) {
            try { ws.terminate(); } catch {}
            return;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
    }, 15000);

    ws.on("close", async () => {
        clearInterval(hb);
        if (ws.userId && ws.conferenceId) {
            await cleanupPeer(ws.conferenceId, ws.userId);
        }
    });

    ws.on("message", async (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch (err) {
            console.error("Invalid JSON:", err);
            return;
        }

        /* =========================
           UNVERÄNDERT: init / conference / chatMessage / ConferenceParticipantsAdded
           ========================= */
        if (msg.type === "init") {
            if (msg.inConference) {
                if (notInConference.has(msg.userId)) notInConference.delete(msg.userId);
                inConference.set(msg.userId, msg.conferenceId);
            } else {
                if (inConference.has(msg.userId)) inConference.delete(msg.userId);
                notInConference.set(msg.userId, msg.conferenceId);
            }
            ws.userId = msg.userId;
            console.log(msg);
            return;
        }

        if (msg.type === "conference") {
            wss.clients.forEach((client) => {
                if (!client.userId) return;
                if (notInConference.has(client.userId)) {
                    client.send(JSON.stringify({
                        type: "server:conference",
                        id: msg.id,
                        title: msg.title,
                        description: msg.description,
                        startAt: msg.startAt,
                        endDate: msg.endDate,
                        status: msg.status,
                        link: msg.link,
                        organizerId: msg.organizerId,
                        participants: msg.participants,
                    }));
                }
            });
            return;
        }

        if (msg.type === "chatMessage") {
            wss.clients.forEach((client) => {
                if (!client.userId) return;
                if (inConference.has(client.userId) && inConference.get(client.userId) === msg.conferenceId) {
                    client.send(JSON.stringify({
                        type: "server:chatMessage",
                        id: msg.id,
                        message: msg.message,
                        userId: msg.userId,
                        conferenceId: msg.conferenceId,
                        user: msg.user,
                    }));
                    console.log(msg);
                }
            });
            return;
        }

        if (msg.type === "ConferenceParticipantsAdded") {
            wss.clients.forEach((client) => {
                client.send(JSON.stringify({
                    type: "server:ConferenceParticipantsAdded",
                    title: msg.title,
                    conferenceId: msg.conferenceId,
                    userIds: msg.userIds,
                    link: msg.link,
                }));
            });
            return;
        }

        if (msg.type === "ConferenceParticipantsRemoved") {
            wss.clients.forEach((client) => {
                client.send(JSON.stringify({
                    type: "server:ConferenceParticipantsRemoved",
                    conferenceId: msg.conferenceId,
                    userIds: msg.userIds,
                    link: msg.link,
                }));
            });
            return;
        }

        if (msg.type === "PresenterChanged") {
            wss.clients.forEach((client) => {
                client.send(JSON.stringify({
                    type: "server:PresenterChanged",
                    conferenceId: msg.conferenceId,
                    presenterUserId: msg.presenterUserId,
                    link: msg.link,
                }));
            });
            return;
        }

        if (msg.type === "QuestionerActivated") {
            wss.clients.forEach((client) => {
                client.send(JSON.stringify({
                    type: "server:QuestionerActivated",
                    conferenceId: msg.conferenceId,
                    userId: msg.userId,
                    link: msg.link,
                }));
            });
            return;
        }

        if (msg.type === "QuestionerDeactivated") {
            wss.clients.forEach((client) => {
                client.send(JSON.stringify({
                    type: "server:QuestionerDeactivated",
                    conferenceId: msg.conferenceId,
                    userId: msg.userId,
                    link: msg.link,
                }));
            });
            return;
        }

        /* =========================
           ✅ CHANGED: SFU handlers now answer with sfu:response
           ========================= */

        // 1) join
        if (msg.type === "sfu:join") { // ✅ CHANGED
            const { requestId, userId, conferenceId, role } = msg;
            try {
                ws.userId = userId;
                ws.conferenceId = conferenceId;

                const room = await getOrCreateRoom(conferenceId);

                // ✅ NEW: wenn gleicher user nochmal joint -> alten Peer sauber kicken
                if (room.peers.has(userId)) {
                    const oldPeer = room.peers.get(userId);
                    if (oldPeer?.ws && oldPeer.ws !== ws) {
                        try { oldPeer.ws.close(); } catch {}
                        await cleanupPeer(conferenceId, userId);
                    }
                }

                if (role === "VIEWER") {
                    safeSend(ws, { type: "server:use-hls", conferenceId });
                    respond(ws, requestId, { routerRtpCapabilities: room.router.rtpCapabilities, existingProducers: [] });
                    return;
                }

                const peer = getPeer(room, userId);
                peer.ws = ws;
                peer.role = role || "PARTICIPANT";

                const existingProducers = [];
                for (const [pid, otherPeer] of room.peers.entries()) {
                    if (pid === userId) continue;
                    for (const prod of otherPeer.producers.values()) {
                        existingProducers.push({ producerId: prod.id, userId: pid, kind: prod.kind });
                    }
                }

                respond(ws, requestId, { // ✅ CHANGED
                    routerRtpCapabilities: room.router.rtpCapabilities,
                    existingProducers,
                });

                broadcastRoom(conferenceId, userId, { type: "sfu:peer-joined", userId });
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 2) create transport
        if (msg.type === "sfu:create-transport") { // ✅ CHANGED
            const { requestId, userId, conferenceId } = msg;
            try {
                const room = await getOrCreateRoom(conferenceId);
                const peer = getPeer(room, userId);

                const transport = await createWebRtcTransport(room.router);
                peer.transports.set(transport.id, transport);

                transport.on("dtlsstatechange", (state) => {
                    if (state === "closed") {
                        try { transport.close(); } catch {}
                        peer.transports.delete(transport.id);
                    }
                });

                respond(ws, requestId, { // ✅ CHANGED: direkt Optionen, nicht wrapper
                    id: transport.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters,
                });
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 3) connect transport
        if (msg.type === "sfu:connect-transport") { // ✅ CHANGED
            const { requestId, userId, conferenceId, transportId, dtlsParameters } = msg;
            try {
                const room = rtcRooms.get(conferenceId);
                const peer = room?.peers.get(userId);
                const transport = peer?.transports.get(transportId);
                if (!transport) throw new Error("transport not found");

                await transport.connect({ dtlsParameters });
                respond(ws, requestId, null);
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 4) produce
        if (msg.type === "sfu:produce") { // ✅ CHANGED
            const { requestId, userId, conferenceId, transportId, kind, rtpParameters, appData } = msg;
            try {
                const room = rtcRooms.get(conferenceId);
                const peer = room?.peers.get(userId);
                const transport = peer?.transports.get(transportId);
                if (!transport) throw new Error("transport not found");

                if (peer?.role === "QUESTIONER") {
                    // Screen-Sharing explizit blockieren (erkennbar an appData oder Track-Label)
                    if (appData?.mediaTag === "screen" || appData?.source === "screen") {
                        throw new Error("Questioners are not allowed to share their screen");
                    }
                }

                const producer = await transport.produce({ kind, rtpParameters, appData });
                peer.producers.set(producer.id, producer);

                producer.on("transportclose", () => peer.producers.delete(producer.id));

                // HLS mapping: Producers automatisch an FFmpeg anbinden
                const mediaTag = appData?.mediaTag; // "cam" | "screen" | undefined
                if (producer.kind === "video") {
                    if (mediaTag === "screen") {
                        await attachProducerToHls(conferenceId, room.router, producer, "screen", userId);
                    } else {
                        // default: cam
                        await attachProducerToHls(conferenceId, room.router, producer, "cam", userId);
                    }
                } else if (producer.kind === "audio") {
                    // Fürs Erste: nur eine Audioquelle aktiv (Presenter ODER Questioner)
                    await attachProducerToHls(conferenceId, room.router, producer, "audio", userId);
                }

                respond(ws, requestId, { id: producer.id }); // ✅ CHANGED

                broadcastRoom(conferenceId, userId, {
                    type: "sfu:new-producer",
                    producerId: producer.id,
                    userId,
                    kind: producer.kind,
                });
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 5) consume
        if (msg.type === "sfu:consume") { // ✅ CHANGED
            const { requestId, userId, conferenceId, producerId, transportId, rtpCapabilities } = msg;
            try {
                const room = rtcRooms.get(conferenceId);
                const peer = room?.peers.get(userId);
                const transport = peer?.transports.get(transportId);
                if (!room || !peer || !transport) throw new Error("room/peer/transport missing");

                if (!room.router.canConsume({ producerId, rtpCapabilities })) {
                    throw new Error("cannot-consume");
                }

                const consumer = await transport.consume({
                    producerId,
                    rtpCapabilities,
                    paused: true,
                });

                peer.consumers.set(consumer.id, consumer);

                consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
                consumer.on("producerclose", () => {
                    peer.consumers.delete(consumer.id);
                    safeSend(ws, { type: "sfu:producer-closed", producerId });
                });

                respond(ws, requestId, { // ✅ CHANGED: Client erwartet genau diese Felder
                    id: consumer.id,
                    producerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                });
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 6) resume consumer
        if (msg.type === "sfu:resume-consumer") { // ✅ CHANGED
            const { requestId, userId, conferenceId, consumerId } = msg;
            try {
                const room = rtcRooms.get(conferenceId);
                const peer = room?.peers.get(userId);
                const consumer = peer?.consumers.get(consumerId);
                if (!consumer) throw new Error("consumer not found");

                await consumer.resume();
                respond(ws, requestId, null);
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 7) leave explicit
        if (msg.type === "sfu:leave") { // ✅ CHANGED
            const { requestId, userId, conferenceId } = msg;
            try {
                await cleanupPeer(conferenceId, userId);
                respond(ws, requestId, null);
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }


    });
});

wsServer.listen(3010, "0.0.0.0", () => {
    console.log("✅ WebSocket-Server läuft auf wss://0.0.0.0:3010");
});
