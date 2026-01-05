import {WebSocketServer} from "ws";
import http from "http";
import fs from "fs";
import dns from "dns";
import {createRequire} from "module";

const require = createRequire(import.meta.url);
const mediasoup = require("mediasoup");
const wsServer = http.createServer();
const wss = new WebSocketServer({server: wsServer});
const inConference = new Map();
const notInConference = new Map();
const rtcRooms = new Map();
const hlsIngest = new Map();

// conferenceId -> { viewers: Map<userId, Set<ws>>, participants: Map<userId, Set<ws>> }
const presenceByConf = new Map();

// conferenceId -> presenterUserId (null wenn kein Präsentator)
const presenterByConf = new Map();

// conferenceId -> organizerUserId
const organizerByConf = new Map();

const WS = {OPEN: 1};

function ensurePresence(confId) {
    let p = presenceByConf.get(confId);
    if (!p) {
        p = { viewers: new Map(), participants: new Map() };
        presenceByConf.set(confId, p);
    }
    return p;
}

function addToPresence(map, userId, ws) {
    let set = map.get(userId);
    if (!set) {
        set = new Set();
        map.set(userId, set);
    }
    set.add(ws);
}

function removeFromPresence(map, userId, ws) {
    const set = map.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) map.delete(userId);
}

function broadcastPresence(confId) {
    const p = presenceByConf.get(confId);
    const payload = {
        type: "server:presence-update",
        conferenceId: confId,
        viewers: p ? Array.from(p.viewers.keys()) : [],
        participants: p ? Array.from(p.participants.keys()) : [],
        ts: Date.now(),
    };

    for (const client of wss.clients) {
        if (client.readyState !== WS.OPEN) continue;
        if (client.conferenceId === confId) safeSend(client, payload);
    }
}

function upsertSocketPresence(ws, confId, userId, inConference) {
    // remove old presence (tab switched conference, role changed, reconnect…)
    if (ws._presence) {
        const { confId: oldConf, userId: oldUid, inConference: oldIn } = ws._presence;
        const oldP = presenceByConf.get(oldConf);
        if (oldP) {
            removeFromPresence(oldIn ? oldP.participants : oldP.viewers, oldUid, ws);
            if (oldP.viewers.size === 0 && oldP.participants.size === 0) presenceByConf.delete(oldConf);
        }
        broadcastPresence(oldConf);
    }

    const p = ensurePresence(confId);
    addToPresence(inConference ? p.participants : p.viewers, userId, ws);
    ws._presence = { confId, userId, inConference };

    broadcastPresence(confId);
}

function removeSocketPresence(ws) {
    if (!ws._presence) return;
    const { confId, userId, inConference } = ws._presence;
    const p = presenceByConf.get(confId);
    if (p) {
        removeFromPresence(inConference ? p.participants : p.viewers, userId, ws);
        if (p.viewers.size === 0 && p.participants.size === 0) presenceByConf.delete(confId);
    }
    ws._presence = null;
    broadcastPresence(confId);
}

function now() {
    return Date.now();
}

let worker;

const mediaCodecs = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        preferredPayloadType: 111
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {},
        preferredPayloadType: 96
    }
];

const ffmpegRtpCapabilities = {
    codecs: [
        {
            kind: "audio",
            mimeType: "audio/opus",
            preferredPayloadType: 111,
            clockRate: 48000,
            channels: 2,
            parameters: {},
            rtcpFeedback: []
        },
        {
            kind: "video",
            mimeType: "video/VP8",
            preferredPayloadType: 96,
            clockRate: 90000,
            parameters: {},
            rtcpFeedback: []
        }
    ],
    headerExtensions: [],
    fecMechanisms: []
};


async function getOrCreateRoom(confId) {
    if (rtcRooms.has(confId)) 
        return rtcRooms.get(confId);

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
        presenterByConf.delete(confId);
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

function getVideoPt(consumer) {
    return consumer.rtpParameters.codecs.find(
        c => c.mimeType.toLowerCase() === "video/vp8"
    )?.payloadType || 96;
}

function getAudioPt(consumer) {
    return consumer.rtpParameters.codecs.find(
        c => c.mimeType.toLowerCase().includes("opus") || c.mimeType.toLowerCase().includes("audio")
    )?.payloadType || 111;
}

function writeSdp(filePath, videoPt = 96, audioPt = 111) {
    const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=DigitalStage
c=IN IP4 0.0.0.0
t=0 0

m=video 5004 RTP/AVP ${videoPt}
a=rtpmap:${videoPt} VP8/90000
a=rtcp:5005
a=recvonly

m=audio 5006 RTP/AVP ${audioPt}
a=rtpmap:${audioPt} opus/48000/2
a=rtcp:5007
a=recvonly

m=video 5008 RTP/AVP ${videoPt}
a=rtpmap:${videoPt} VP8/90000
a=rtcp:5009
a=recvonly

m=audio 5010 RTP/AVP ${audioPt}
a=rtpmap:${audioPt} opus/48000/2
a=rtcp:5011
a=recvonly

m=video 5012 RTP/AVP ${videoPt}
a=rtpmap:${videoPt} VP8/90000
a=rtcp:5013
a=recvonly

m=audio 5014 RTP/AVP ${audioPt}
a=rtpmap:${audioPt} opus/48000/2
a=rtcp:5015
a=recvonly

m=video 5016 RTP/AVP ${videoPt}
a=rtpmap:${videoPt} VP8/90000
a=rtcp:5017
a=recvonly

m=audio 5018 RTP/AVP ${audioPt}
a=rtpmap:${audioPt} opus/48000/2
a=rtcp:5019
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
        const res = await dns.promises.lookup(ffmpegHostname, {family: 4});
        targetIp = res.address;
        console.log(`✅ Resolved FFmpeg hostname '${ffmpegHostname}' to IP: ${targetIp}`);
    } catch {
        console.warn(`⚠️  FFmpeg DNS failed, using fallback IP ${targetIp}`);
    }

    // Port-Zuordnung basierend auf Anforderung:
    // Screen: Video 5004, Audio 5006
    // Presenter: Video 5008, Audio 5010
    // Questioner: Video 5012, Audio 5014
    // Organizer: Video 5016, Audio 5018
    const transports = {
        screenVideo:     await createPlainOut(router, { ip: targetIp, port: 5004, rtcpPort: 5005 }),
        screenAudio:     await createPlainOut(router, { ip: targetIp, port: 5006, rtcpPort: 5007 }),
        presenterVideo:  await createPlainOut(router, { ip: targetIp, port: 5008, rtcpPort: 5009 }),
        presenterAudio:  await createPlainOut(router, { ip: targetIp, port: 5010, rtcpPort: 5011 }),
        questionerVideo: await createPlainOut(router, { ip: targetIp, port: 5012, rtcpPort: 5013 }),
        questionerAudio: await createPlainOut(router, { ip: targetIp, port: 5014, rtcpPort: 5015 }),
        organizerVideo:  await createPlainOut(router, { ip: targetIp, port: 5016, rtcpPort: 5017 }),
        organizerAudio:  await createPlainOut(router, { ip: targetIp, port: 5018, rtcpPort: 5019 }),
    };
    
    // SDP-Datei schreiben (einmalig bei Init, damit FFmpeg starten kann)
    writeSdp("/sdp/input.sdp");

    const state = {
        routerId: router.id,
        started: false,
        transports,
        consumers: {
            screenVideo: null,
            screenAudio: null,
            presenterVideo: null,
            presenterAudio: null,
            questionerVideo: null,
            questionerAudio: null,
            organizerVideo: null,
            organizerAudio: null,
        },
    };

    hlsIngest.set(conferenceId, state);
    return state;
}


function startFfmpeg(conferenceId) {
    console.log("🚀 Starting FFmpeg for conference", conferenceId);
}

async function attachProducerToHls(conferenceId, router, producer, userId, streamType) {
    // streamType: "screenVideo", "screenAudio", "presenterVideo", "presenterAudio", "questionerVideo", "questionerAudio", "organizerVideo", "organizerAudio"
    const ingest = await initHlsForConference(conferenceId, router);

    // Start FFmpeg beim ersten Producer
    if (!ingest.started) {
        startFfmpeg(conferenceId);
        ingest.started = true;
    }

    // Alten Consumer schließen
    if (ingest.consumers[streamType]) {
        try { ingest.consumers[streamType].close(); } catch {}
        ingest.consumers[streamType] = null;
    }

    const plainTransport = ingest.transports[streamType];
    if (!plainTransport) {
        console.error(`Transport ${streamType} nicht gefunden`);
        return;
    }

    const consumer = await plainTransport.consume({
        producerId: producer.id,
        rtpCapabilities: ffmpegRtpCapabilities,
        paused: false,
    });

    ingest.consumers[streamType] = consumer;

    if (consumer.kind === "video") {
        await consumer.requestKeyFrame();
        const iv = setInterval(() => {
            consumer.requestKeyFrame().catch(() => {});
        }, 2000);
        consumer.on("transportclose", () => clearInterval(iv));
        consumer.on("producerclose", () => clearInterval(iv));
    }

    console.log(`✅ HLS ${streamType} attached: producer ${producer.id}, consumer ${consumer.id}`);
}


// ✅ CHANGED: Transport helper (ANNOUNCED_IP matcht .env)
async function createWebRtcTransport(router) {
    const transport = await router.createWebRtcTransport({
        listenIps: [
            {
                ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
                announcedIp: process.env.ANNOUNCED_IP || process.env.MEDIASOUP_ANNOUNCED_IP || null,
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
        removeSocketPresence(ws);
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
            const userId = msg.userId;
            const conferenceId = msg.conferenceId;
            const inConf = !!msg.inConference;

            if (!userId || !conferenceId) return;

            ws.userId = userId;
            ws.conferenceId = conferenceId;
            ws.inConference = inConf;

            // optional: alte Maps weiter pflegen (wenn du sie noch brauchst)
            if (inConf) {
                notInConference.delete(userId);
                inConference.set(userId, conferenceId);
            } else {
                inConference.delete(userId);
                notInConference.set(userId, conferenceId);
            }

            upsertSocketPresence(ws, conferenceId, userId, inConf);
            console.log(msg);
            return;
        }

        if (msg.type === "conference") {
            // Organizer-ID tracken
            if (msg.organizerId && msg.id) {
                organizerByConf.set(msg.id, msg.organizerId);
            }
            
            // Sende an alle Clients, damit sie die Konferenzliste aktualisieren können
            for (const client of wss.clients) {
                if (client.readyState !== WS.OPEN) continue;
                if (client.conferenceId !== msg.id) continue; // ✅ wichtig: nur diese Konferenz
                safeSend(client, {
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
                });
            }
            return;
        }

        if (msg.type === "chatMessage") {
            for (const client of wss.clients) {
                if (client.readyState !== WS.OPEN) continue;
                if (client.conferenceId !== msg.conferenceId) continue;
                safeSend(client, {
                    type: "server:chatMessage",
                    id: msg.id,
                    message: msg.message,
                    userId: msg.userId,
                    conferenceId: msg.conferenceId,
                    user: msg.user,
                });
            }
            console.log(msg);
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
            // Präsentator-Status tracken
            if (msg.presenterUserId) {
                presenterByConf.set(msg.conferenceId, msg.presenterUserId);
            } else {
                presenterByConf.delete(msg.conferenceId);
            }
            
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

                // HLS-Infrastruktur initialisieren, wenn jemand als WebRTC-Teilnehmer joint (nicht Viewer)
                if (role !== "VIEWER") {
                    await initHlsForConference(conferenceId, room.router).catch(err => {
                        console.error("Failed to init HLS for conference:", err);
                    });
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
                const presenterUserId = presenterByConf.get(conferenceId);
                const organizerUserId = organizerByConf.get(conferenceId);
                const isPresenter = presenterUserId === userId;
                const isOrganizer = organizerUserId === userId;
                const isQuestioner = peer?.role === "QUESTIONER";
                const isOrganizerPresenter = isOrganizer && isPresenter;
                
                if (producer.kind === "video") {
                    if (mediaTag === "screen") {
                        // Screen-Sharing NUR vom Präsentator
                        if (!isPresenter) {
                            console.warn(`User ${userId} versucht Screen-Sharing, ist aber nicht Präsentator`);
                            // Producer wird trotzdem erstellt, aber nicht an HLS gebunden
                        } else {
                            await attachProducerToHls(conferenceId, room.router, producer, userId, "screenVideo").catch(err => console.error("HLS Screen Video attach failed:", err));
                        }
                    } else {
                        // Kamera-Video
                        if (isQuestioner) {
                            // Questioner Video
                            await attachProducerToHls(conferenceId, room.router, producer, userId, "questionerVideo").catch(err => console.error("HLS Questioner Video attach failed:", err));
                        } else if (isPresenter && !isOrganizerPresenter) {
                            // Presenter Video (nur wenn Organizer ≠ Präsentator)
                            await attachProducerToHls(conferenceId, room.router, producer, userId, "presenterVideo").catch(err => console.error("HLS Presenter Video attach failed:", err));
                        } else if (isOrganizer && !isOrganizerPresenter) {
                            // Organizer Video (nur wenn Organizer ≠ Präsentator)
                            await attachProducerToHls(conferenceId, room.router, producer, userId, "organizerVideo").catch(err => console.error("HLS Organizer Video attach failed:", err));
                        }
                    }
                } else if (producer.kind === "audio") {
                    // Audio-Mapping
                    if (isQuestioner) {
                        // Questioner Audio
                        await attachProducerToHls(conferenceId, room.router, producer, userId, "questionerAudio").catch(err => console.error("HLS Questioner Audio attach failed:", err));
                    } else if (isPresenter && !isOrganizerPresenter) {
                        // Presenter Audio (nur wenn Organizer ≠ Präsentator)
                        await attachProducerToHls(conferenceId, room.router, producer, userId, "presenterAudio").catch(err => console.error("HLS Presenter Audio attach failed:", err));
                        // Screen Audio auch vom Präsentator
                        await attachProducerToHls(conferenceId, room.router, producer, userId, "screenAudio").catch(err => console.error("HLS Screen Audio attach failed:", err));
                    } else if (isOrganizer && !isOrganizerPresenter) {
                        // Organizer Audio (nur wenn Organizer ≠ Präsentator)
                        await attachProducerToHls(conferenceId, room.router, producer, userId, "organizerAudio").catch(err => console.error("HLS Organizer Audio attach failed:", err));
                    } else if (isOrganizerPresenter) {
                        // Organizer = Präsentator: nur Screen Audio
                        await attachProducerToHls(conferenceId, room.router, producer, userId, "screenAudio").catch(err => console.error("HLS Screen Audio attach failed:", err));
                    }
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
