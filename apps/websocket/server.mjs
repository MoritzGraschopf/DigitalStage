import { WebSocketServer } from "ws";
import http from "http";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const mediasoup = require("mediasoup");

const server = http.createServer();
const wss = new WebSocketServer({ server });

const inConference = new Map();
const notInConference = new Map();

const rtcRooms = new Map();

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
        logLevel: "warn",
        logTags: ["ice", "dtls", "rtp", "srtp", "rtcp"],
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

                const producer = await transport.produce({ kind, rtpParameters, appData });
                peer.producers.set(producer.id, producer);

                producer.on("transportclose", () => peer.producers.delete(producer.id));

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

server.listen(3010, "0.0.0.0", () => {
    console.log("✅ WebSocket-Server läuft auf wss://0.0.0.0:3010");
});
