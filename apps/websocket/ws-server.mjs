import {WebSocketServer} from "ws";
import http from "http";
import fs from "fs";
import path from "path";
import dns from "dns";
import {promisify} from "util";

const dnsLookup = promisify(dns.lookup);

import {createRequire} from "module";

const require = createRequire(import.meta.url);
const mediasoup = require("mediasoup");

const wsServer = http.createServer();
const wss = new WebSocketServer({server: wsServer});

const inConference = new Map();
const notInConference = new Map();

const rtcRooms = new Map();

// HLS Ingest State pro Conference
// conferenceId -> HlsState
const hlsIngest = new Map();

const WS = {OPEN: 1};

function now() {
    return Date.now();
}

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

    const router = await worker.createRouter({mediaCodecs});
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

async function cleanupHls(confId) {
    const ingest = hlsIngest.get(confId);
    if (!ingest) return;

    try {
        for (const c of Object.values(ingest.consumers || {})) {
            try { c?.close(); } catch {}
        }
        for (const t of Object.values(ingest.transports || {})) {
            try { t?.close(); } catch {}
        }
    } finally {
        hlsIngest.delete(confId);
    }
}

async function cleanupPeer(confId, userId) {
    const room = rtcRooms.get(confId);
    if (!room) return;

    const peer = room.peers.get(userId);
    if (!peer) return;

    for (const c of peer.consumers.values()) {
        try {
            c.close();
        } catch {
        }
    }
    peer.consumers.clear();

    for (const p of peer.producers.values()) {
        try {
            p.close();
        } catch {
        }
        broadcastRoom(confId, userId, {type: "sfu:producer-closed", userId, producerId: p.id});
    }
    peer.producers.clear();

    for (const t of peer.transports.values()) {
        try {
            t.close();
        } catch {
        }
    }
    peer.transports.clear();

    room.peers.delete(userId);
    broadcastRoom(confId, userId, {type: "sfu:peer-left", userId});

    if (room.peers.size === 0) {
        await cleanupHls(confId);
        try {
            room.router.close();
        }
        catch {}
        rtcRooms.delete(confId);
    }
}

/* =========================
   ✅ NEW: request/response helpers
   ========================= */
function respond(ws, requestId, data = null) { // ✅ NEW
    safeSend(ws, {type: "sfu:response", responseId: requestId, ok: true, data});
}

function respondError(ws, requestId, error) { // ✅ NEW
    safeSend(ws, {type: "sfu:response", responseId: requestId, ok: false, error: String(error || "error")});
}

// =========================
// HLS Helper Functions
// =========================

async function ensureDir(p) {
    await fs.promises.mkdir(p, {recursive: true});
}

function writeSdp(filePath, videoSizes = {cam: null, screen: null}) {
    // Standard-Video-Größe, falls nicht angegeben (1280x720)
    const camSize = videoSizes.cam || "1280x720";
    const screenSize = videoSizes.screen || "1920x1080";

    const [camWidth, camHeight] = camSize.split("x");
    const [screenWidth, screenHeight] = screenSize.split("x");

    // SDP mit korrekter Formatierung (keine führenden Leerzeichen)
    // Für VP8 gibt es kein Standard-SDP-Attribut für Auflösung,
    // aber wir können sie in fmtp als Hinweis angeben
    const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=DigitalStage
c=IN IP4 0.0.0.0
t=0 0
m=video 5004 RTP/AVP 96
a=rtpmap:96 VP8/90000
a=fmtp:96 max-fr=30;max-fs=${parseInt(camWidth) * parseInt(camHeight) / 256}
a=recvonly
m=video 5006 RTP/AVP 97
a=rtpmap:97 VP8/90000
a=fmtp:97 max-fr=30;max-fs=${parseInt(screenWidth) * parseInt(screenHeight) / 256}
a=recvonly
m=audio 5008 RTP/AVP 111
a=rtpmap:111 opus/48000/2
a=recvonly
`;
    fs.writeFileSync(filePath, sdp);
}

async function createPlainOut(router, {ip, port, rtcpPort}) {
    const transport = await router.createPlainTransport({
        listenIp: {ip: "0.0.0.0", announcedIp: null},
        rtcpMux: false,
        comedia: false,
    });

    // Verbinde den PlainTransport mit FFmpeg
    await transport.connect({ip, port, rtcpPort});

    console.log(`✅ PlainTransport created:`);
    console.log(`   - Listening on: ${transport.tuple.localIp}:${transport.tuple.localPort}`);
    console.log(`   - Connected to FFmpeg at: ${ip}:${port} (RTP) / ${ip}:${rtcpPort} (RTCP)`);

    return transport;
}

/*
async function initHlsForConference(conferenceId, router) {
    if (hlsIngest.has(conferenceId)) {
        return hlsIngest.get(conferenceId);
    }

    // Verzeichnisse vorbereiten
    await ensureDir(`/hls/testconf/cam`);
    await ensureDir(`/hls/testconf/screen`);
    await ensureDir(`/hls/testconf/audio`);

    // FFmpeg IP auflösen
    const ffmpegHostname = process.env.FFMPEG_HOST || "digitalstage_ffmpeg";
    let targetIp = process.env.FFMPEG_IP || "127.0.0.1";

    try {
        const res = await dnsLookup(ffmpegHostname);
        targetIp = res.address;
        console.log(`✅ Resolved FFmpeg hostname '${ffmpegHostname}' to IP: ${targetIp}`);
    } catch (err) {
        console.log(`⚠️  Could not resolve '${ffmpegHostname}', using fallback IP: ${targetIp}`);
    }

    // Eigener Router für FFmpeg
    const ffmpegRouter = await worker.createRouter({ mediaCodecs });

    // PipeTransport zwischen Main-Router und FFmpeg-Router
    const pipeTransport = await router.createPipeTransport({
        listenIp: { ip: "127.0.0.1", announcedIp: null },
        enableSctp: false,
    });

    const ffmpegPipeTransport = await ffmpegRouter.createPipeTransport({
        listenIp: { ip: "127.0.0.1", announcedIp: null },
        enableSctp: false,
    });

    await pipeTransport.connect({
        ip: ffmpegPipeTransport.tuple.localIp,
        port: ffmpegPipeTransport.tuple.localPort,
    });

    await ffmpegPipeTransport.connect({
        ip: pipeTransport.tuple.localIp,
        port: pipeTransport.tuple.localPort,
    });

    // PlainTransports → FFmpeg
    const transports = {
        cam: await createPlainOut(ffmpegRouter, { ip: targetIp, port: 5004, rtcpPort: 5005 }),
        screen: await createPlainOut(ffmpegRouter, { ip: targetIp, port: 5006, rtcpPort: 5007 }),
        audio: await createPlainOut(ffmpegRouter, { ip: targetIp, port: 5008, rtcpPort: 5009 }),
    };

    const state = {
        initialized: true,
        started: false,
        router: ffmpegRouter,
        pipeTransport,
        ffmpegPipeTransport,
        transports,
        consumers: { cam: null, screen: null, audio: null },
        videoSizes: { cam: null, screen: null },
        activeAudioUserId: null,
    };

    hlsIngest.set(conferenceId, state);
    return state;
}

*/

async function initHlsForConference(conferenceId, router) {
    const existing = hlsIngest.get(conferenceId);
    if (existing && existing.routerId === router.id)
        return existing;
    if (existing)
        await cleanupHls(conferenceId);

    await ensureDir("/sdp");

    const ffmpegHostname = process.env.FFMPEG_HOST || "digitalstage_ffmpeg";
    let targetIp = process.env.FFMPEG_IP || "127.0.0.1";

    try {
        const res = await dnsLookup(ffmpegHostname);
        targetIp = res.address;
        console.log(`✅ Resolved FFmpeg hostname '${ffmpegHostname}' to IP: ${targetIp}`);
    } catch {
        console.warn(`⚠️  FFmpeg DNS failed, using fallback IP ${targetIp}`);
    }

    const transports = {
        cam: await createPlainOut(router, {ip: targetIp, port: 5004, rtcpPort: 5005}),
        screen: await createPlainOut(router, {ip: targetIp, port: 5006, rtcpPort: 5007}),
        audio: await createPlainOut(router, {ip: targetIp, port: 5008, rtcpPort: 5009}),
    };

    const state = {
        routerId: router.id,
        started:false,
        transports,
        consumers:{},
        videoSizes:{}
    };

    hlsIngest.set(conferenceId, state);
    return state;
}


function startFfmpeg(conferenceId) {
    console.log("🚀 Starting FFmpeg for conference", conferenceId);
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

/*
async function attachProducerToHls(conferenceId, router, producer, tag, userId) {
    const ingest = await initHlsForConference(conferenceId, router);

    // Cleanup alter Consumer wenn bereits belegt
    if (ingest.consumers[tag]) {
        try {
            const oldConsumer = ingest.consumers[tag];
            if (oldConsumer?.consumer) oldConsumer.consumer.close();
            if (oldConsumer?.tempTransport) oldConsumer.tempTransport.close();
            if (oldConsumer?.pipeProducer) oldConsumer.pipeProducer.close();
            if (oldConsumer?.pipeConsumer) oldConsumer.pipeConsumer.close();
            if (oldConsumer?.plainProducer) oldConsumer.plainProducer.close();
            if (oldConsumer?.ffmpegTempTransport) oldConsumer.ffmpegTempTransport.close();
        } catch {
            // Ignore cleanup errors
        }
        ingest.consumers[tag] = null;
    }

    // Nur EIN Video-Producer startet HLS
    const isVideo = producer.kind === "video";

    // Video-Größe festlegen (konservativ, stabil)
    if (isVideo) {
        ingest.videoSizes[tag] =
            tag === "screen" ? "1920x1080" : "1280x720";

        // SDP JETZT schreiben – mit echten Größen
        writeSdp(`/sdp/input.sdp`, ingest.videoSizes);
    }

    // FFmpeg GENAU EINMAL starten
    if (isVideo && !ingest.started) {
        startFfmpeg(conferenceId);
        ingest.started = true;
    }

    // --- Rest: Media weiterleiten ---
    // (unverändert zu eurem bestehenden Pipe → Plain Flow)

    const tempTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: "127.0.0.1", announcedIp: null }],
        enableUdp: false,
        enableTcp: true,
    });

    const consumer = await tempTransport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: false,
    });

    // Consumer explizit starten (falls nötig)
    if (consumer.paused) {
        await consumer.resume();
    }

    const pipeProducer = await ingest.pipeTransport.produce({
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
    });

    const ffmpegTempTransport = await ingest.router.createWebRtcTransport({
        listenIps: [{ ip: "127.0.0.1", announcedIp: null }],
        enableUdp: false,
        enableTcp: true,
    });

    const pipeConsumer = await ffmpegTempTransport.consume({
        producerId: pipeProducer.id,
        rtpCapabilities: ingest.router.rtpCapabilities,
        paused: false,
    });

    // Consumer explizit starten (falls nötig)
    if (pipeConsumer.paused) {
        await pipeConsumer.resume();
    }

    const plainProducer = await ingest.transports[tag].produce({
        kind: pipeConsumer.kind,
        rtpParameters: sanitizeRtpParameters(pipeConsumer.rtpParameters),
    });

    // Event-Handler für Debugging
    plainProducer.on("transportclose", () => {
        console.log(`⚠️  PlainProducer transport closed for ${tag}`);
    });

    console.log(`✅ HLS Producer attached: ${tag} (${producer.kind}) -> FFmpeg`);
    console.log(`   - PlainProducer ID: ${plainProducer.id}`);
    console.log(`   - SSRC: ${sanitizeRtpParameters(pipeConsumer.rtpParameters).encodings[0]?.ssrc}`);

    // Alle Objekte speichern für späteres Cleanup
    ingest.consumers[tag] = {
        consumer,
        pipeProducer,
        pipeConsumer,
        plainProducer,
        tempTransport,
        ffmpegTempTransport,
    };

    // Event-Handler für automatisches Cleanup
    consumer.on("transportclose", () => {
        if (ingest.consumers[tag]) ingest.consumers[tag] = null;
    });
    producer.on("transportclose", () => {
        if (ingest.consumers[tag]) ingest.consumers[tag] = null;
    });

    // Audio-Owner merken (für zukünftige Audio-Failover-Logik)
    if (tag === "audio") {
        ingest.activeAudioUserId = userId;
    }
}

*/

async function attachProducerToHls(conferenceId, router, producer, tag) {
    const ingest = await initHlsForConference(conferenceId, router);

    // alte Consumer sauber schließen (wichtig!)
    if (ingest.consumers[tag]) {
        try {
            ingest.consumers[tag].close();
        } catch {
        }
        ingest.consumers[tag] = null;
    }

    // bei erstem Video: SDP schreiben + FFmpeg starten
    if (!ingest.started && producer.kind === "video") {
        ingest.videoSizes[tag] =
            tag === "screen" ? "1920x1080" : "1280x720";

        writeSdp("/sdp/input.sdp", ingest.videoSizes);
        startFfmpeg(conferenceId);
        ingest.started = true;
    }

    const plainTransport = ingest.transports[tag];

    const consumer = await plainTransport.consume({
        producerId: producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: false,
    });

    console.log(`✅ RTP flowing to FFmpeg (${tag}) → consumer ${consumer.id}`);

    ingest.consumers[tag] = consumer;
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
            try {
                ws.terminate();
            } catch {
            }
            return;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch {
        }
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
            const {requestId, userId, conferenceId, role} = msg;
            try {
                ws.userId = userId;
                ws.conferenceId = conferenceId;

                const room = await getOrCreateRoom(conferenceId);

                // ✅ NEW: wenn gleicher user nochmal joint -> alten Peer sauber kicken
                if (room.peers.has(userId)) {
                    const oldPeer = room.peers.get(userId);
                    if (oldPeer?.ws && oldPeer.ws !== ws) {
                        try {
                            oldPeer.ws.close();
                        } catch {
                        }
                        await cleanupPeer(conferenceId, userId);
                    }
                }

                if (role === "VIEWER") {
                    safeSend(ws, {type: "server:use-hls", conferenceId});
                    respond(ws, requestId, {routerRtpCapabilities: room.router.rtpCapabilities, existingProducers: []});
                    return;
                }

                const peer = getPeer(room, userId);
                peer.ws = ws;
                peer.role = role || "PARTICIPANT";

                const existingProducers = [];
                for (const [pid, otherPeer] of room.peers.entries()) {
                    if (pid === userId) continue;
                    for (const prod of otherPeer.producers.values()) {
                        existingProducers.push({producerId: prod.id, userId: pid, kind: prod.kind});
                    }
                }

                respond(ws, requestId, { // ✅ CHANGED
                    routerRtpCapabilities: room.router.rtpCapabilities,
                    existingProducers,
                });

                broadcastRoom(conferenceId, userId, {type: "sfu:peer-joined", userId});
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 2) create transport
        if (msg.type === "sfu:create-transport") { // ✅ CHANGED
            const {requestId, userId, conferenceId} = msg;
            try {
                const room = await getOrCreateRoom(conferenceId);
                const peer = getPeer(room, userId);

                const transport = await createWebRtcTransport(room.router);
                peer.transports.set(transport.id, transport);

                transport.on("dtlsstatechange", (state) => {
                    if (state === "closed") {
                        try {
                            transport.close();
                        } catch {
                        }
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
            const {requestId, userId, conferenceId, transportId, dtlsParameters} = msg;
            try {
                const room = rtcRooms.get(conferenceId);
                const peer = room?.peers.get(userId);
                const transport = peer?.transports.get(transportId);
                if (!transport) throw new Error("transport not found");

                await transport.connect({dtlsParameters});
                respond(ws, requestId, null);
            } catch (e) {
                respondError(ws, requestId, e);
            }

            console.log(msg);
            return;
        }

        // 4) produce
        if (msg.type === "sfu:produce") { // ✅ CHANGED
            const {requestId, userId, conferenceId, transportId, kind, rtpParameters, appData} = msg;
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

                const producer = await transport.produce({kind, rtpParameters, appData});
                peer.producers.set(producer.id, producer);

                producer.on("transportclose", () => peer.producers.delete(producer.id));

                // HLS mapping: Producers automatisch an FFmpeg anbinden
                const mediaTag = appData?.mediaTag; // "cam" | "screen" | undefined
                if (producer.kind === "video") {
                    if (mediaTag === "screen") {
                        await attachProducerToHls(conferenceId, room.router, producer, "screen").catch(err => console.error("HLS Screen attach failed:", err));
                    } else {
                        // default: cam
                        await attachProducerToHls(conferenceId, room.router, producer, "cam").catch(err => console.error("HLS Cam attach failed:", err));
                    }
                } else if (producer.kind === "audio") {
                    // Fürs Erste: nur eine Audioquelle aktiv (Presenter ODER Questioner)
                    await attachProducerToHls(conferenceId, room.router, producer, "audio").catch(err => console.error("HLS Audio attach failed:", err));
                }

                respond(ws, requestId, {id: producer.id}); // ✅ CHANGED

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
            const {requestId, userId, conferenceId, producerId, transportId, rtpCapabilities} = msg;
            try {
                const room = rtcRooms.get(conferenceId);
                const peer = room?.peers.get(userId);
                const transport = peer?.transports.get(transportId);
                if (!room || !peer || !transport) throw new Error("room/peer/transport missing");

                if (!room.router.canConsume({producerId, rtpCapabilities})) {
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
                    safeSend(ws, {type: "sfu:producer-closed", producerId});
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
            const {requestId, userId, conferenceId, consumerId} = msg;
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
            const {requestId, userId, conferenceId} = msg;
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
