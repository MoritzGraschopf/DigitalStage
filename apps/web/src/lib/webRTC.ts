import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as mediasoupClient from "mediasoup-client";

type Role = "ORGANIZER" | "PARTICIPANT" | "VIEWER" | "QUESTIONER";

type SignalSocket = {
    addEventListener: (ev: "message", cb: (ev: MessageEvent) => void) => void;
    removeEventListener: (ev: "message", cb: (ev: MessageEvent) => void) => void;
    readyState: number;
};

type Device = mediasoupClient.types.Device;
type Transport = mediasoupClient.types.Transport;
type RtpCapabilities = mediasoupClient.types.RtpCapabilities;
type RtpParameters = mediasoupClient.types.RtpParameters;
type DtlsParameters = mediasoupClient.types.DtlsParameters;
type IceParameters = mediasoupClient.types.IceParameters;
type IceCandidate = mediasoupClient.types.IceCandidate;
type SctpParameters = mediasoupClient.types.SctpParameters;
type Producer = mediasoupClient.types.Producer;

// ---- SFU WS Message Shapes
type SfuRequestType =
    | "sfu:join"
    | "sfu:create-transport"
    | "sfu:connect-transport"
    | "sfu:produce"
    | "sfu:consume"
    | "sfu:resume-consumer"
    | "sfu:leave";

type SfuResponseMsg<T> = {
    type: "sfu:response";
    responseId: string;
    ok: boolean;
    data?: T;
    error?: string;
};

type SfuNewProducerMsg = {
    type: "sfu:new-producer";
    producerId: string;
    userId: string;
};

type SfuProducerClosedMsg = {
    type: "sfu:producer-closed";
    producerId: string;
    userId: string;
    kind?: mediasoupClient.types.MediaKind;
};

type SfuPeerLeftMsg = {
    type: "sfu:peer-left";
    userId: string;
};

type IncomingMsg<T = unknown> =
    | SfuResponseMsg<T>
    | SfuNewProducerMsg
    | SfuProducerClosedMsg
    | SfuPeerLeftMsg
    | { type: string; [k: string]: unknown };

// ---- SFU Responses
type ExistingProducer = { producerId: string; userId: string };

type SfuJoinRes = {
    routerRtpCapabilities: RtpCapabilities;
    existingProducers: ExistingProducer[];
};

type TransportDirection = "send" | "recv";

type SfuTransportOptions = {
    id: string;
    iceParameters: IceParameters;
    iceCandidates: IceCandidate[];
    dtlsParameters: DtlsParameters;
    sctpParameters?: SctpParameters;
};

type SfuCreateTransportRes = SfuTransportOptions;

type SfuConsumeResOk = {
    id: string;
    producerId: string;
    kind: mediasoupClient.types.MediaKind;
    rtpParameters: RtpParameters;
};

type Pending<T> = {
    resolve: (v: T) => void;
    reject: (e: Error) => void;
};

// ---- Mini Typeguards
function isObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === "object";
}

function hasType(v: unknown): v is { type: string } {
    return isObject(v) && typeof v.type === "string";
}

export function useWebRTC(params: {
    socket: SignalSocket;
    send: (obj: unknown) => void;
    userId: string;
    conferenceId: string;
    role: Role;
}) {
    const { socket, send, userId, conferenceId, role } = params;

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
    const [audioMuteStatus, setAudioMuteStatus] = useState<Record<string, boolean>>({});

    const initKeyRef = useRef<string | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);
    const screenProducerRef = useRef<Producer | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
    const pendingRef = useRef<Map<string, Pending<unknown>>>(new Map());
    const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
    const pendingNewProducersRef = useRef<
        Array<{ userId: string; producerId: string; kind?: string }>
    >([]);

    // aktuelle Werte für request()
    const sendRef = useRef(send);
    const userIdRef = useRef(userId);
    const confIdRef = useRef(conferenceId);

    useEffect(() => {
        sendRef.current = send;
        userIdRef.current = userId;
        confIdRef.current = conferenceId;
    }, [send, userId, conferenceId]);

    const request = useCallback(<T,>(
        type: SfuRequestType,
        data: Record<string, unknown> = {}
    ) => {
        const requestId = crypto.randomUUID();
        return new Promise<T>((resolve, reject) => {
            pendingRef.current.set(requestId, {
                resolve: resolve as Pending<unknown>["resolve"],
                reject,
            });

            sendRef.current({
                type,
                requestId,
                userId: userIdRef.current,
                conferenceId: confIdRef.current,
                ...data,
            });
        });
    }, []);

    // ICE Server (STUN/TURN) – stabil via useMemo
    const iceServers = useMemo<RTCIceServer[]>(() => {
        const stun = process.env.NEXT_PUBLIC_STUN_URL;
        const servers: RTCIceServer[] = [];
        if (stun)
            servers.push({ urls: stun });
        return servers;
    }, []);

    // ----- consume helper
    const consumedRef = useRef<Map<string, string>>(new Map());

    const consume = useCallback(
        async (fromUserId: string, producerId: string) => {
            if(fromUserId === userIdRef.current){
                return;
            }

            const device = deviceRef.current;
            const recvTransport = recvTransportRef.current;
            if (!device || !recvTransport) {
                console.warn("consume: device or recvTransport missing");
                return;
            }

            // doppelte producer vermeiden
            if (consumedRef.current.has(producerId)) {
                return;
            }

            try {
                const res = await request<SfuConsumeResOk>("sfu:consume", {
                    transportId: recvTransport.id,
                    producerId,
                    rtpCapabilities: device.rtpCapabilities,
                });

                const consumer = await recvTransport.consume({
                    id: res.id,
                    producerId: res.producerId,
                    kind: res.kind,
                    rtpParameters: res.rtpParameters,
                });

                consumedRef.current.set(producerId, fromUserId);

                const track = consumer.track;

                await request<null>("sfu:resume-consumer", { consumerId: consumer.id });
                try {
                    await consumer.resume();
                } catch (err) {
                    console.warn("consume: consumer.resume failed", err);
                }

                const applyTrack = () => {
                    let managedStream = remoteStreamsRef.current.get(fromUserId);
                    if (!managedStream) {
                        managedStream = new MediaStream();
                        remoteStreamsRef.current.set(fromUserId, managedStream);
                    }

                    // alte Tracks vom selben Typ ersetzen
                    const existing = managedStream.getTracks().filter((t) => t.kind === track.kind);
                    for (const existingTrack of existing) {
                        managedStream.removeTrack(existingTrack);
                        try {
                            existingTrack.stop();
                        } catch {
                            /* ignore */
                        }
                    }

                    managedStream.addTrack(track);

                    const uiStream = new MediaStream(managedStream.getTracks());
                    setRemoteStreams((prev) => ({
                        ...prev,
                        [fromUserId]: uiStream,
                    }));

                    // Mikrofon-Status tracken für Audio-Tracks
                    if (track.kind === "audio") {
                        const updateMuteStatus = () => {
                            setAudioMuteStatus((prev) => ({
                                ...prev,
                                [fromUserId]: track.muted || !track.enabled,
                            }));
                        };
                        updateMuteStatus();
                        track.onmute = updateMuteStatus;
                        track.onunmute = updateMuteStatus;
                        track.onended = () => {
                            setAudioMuteStatus((prev) => {
                                const next = { ...prev };
                                delete next[fromUserId];
                                return next;
                            });
                        };
                    }
                };

                if (track.muted) {
                    let applied = false;
                    track.onunmute = () => {
                        track.onunmute = null;
                        if (!applied) {
                            applied = true;
                            applyTrack();
                        }
                    };

                    setTimeout(() => {
                        if (!applied) {
                            applied = true;
                            applyTrack();
                        }
                    }, 3000);
                } else {
                    applyTrack();
                }
            } catch (e) {
                consumedRef.current.delete(producerId);
                if (String(e).includes("cannot-consume")) {
                    console.warn("consume: cannot-consume, probably stale producer");
                    return;
                }
                console.error("consume failed", e);
            }
        },
        [request]
    );

    // pending new-producers verarbeiten
    const processPendingNewProducers = useCallback(async () => {
        if (!deviceRef.current || !recvTransportRef.current) return;

        const queue = pendingNewProducersRef.current;
        if (queue.length === 0) return;

        const toProcess = [...queue];
        pendingNewProducersRef.current = [];

        for (const item of toProcess) {
            if (consumedRef.current.has(item.producerId)) continue;

            try {
                await consume(item.userId, item.producerId);
            } catch (err) {
                console.error("processPendingNewProducers failed", err);
            }
        }
    }, [consume]);

    // ----- WS listener
    useEffect(() => {
        const onMessage = async (ev: MessageEvent) => {
            let msgUnknown: unknown;
            try {
                msgUnknown = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
            } catch (e) {
                console.error("WS parse failed", e);
                return;
            }
            if (!hasType(msgUnknown)) return;
            const msg = msgUnknown as IncomingMsg;

            if (msg.type === "sfu:response") {
                const r = msg as SfuResponseMsg<unknown>;
                const p = pendingRef.current.get(r.responseId);

                if (!p) {
                    console.warn("response without pending request", r.responseId);
                    return;
                }

                pendingRef.current.delete(r.responseId);

                if (r.ok) {
                    p.resolve(r.data);
                } else {
                    console.error("SFU response error", r.error);
                    p.reject(new Error(r.error ?? "SFU request failed"));
                }
                return;
            }

            if (msg.type === "sfu:new-producer") {
                const m = msg as SfuNewProducerMsg;

                if (consumedRef.current.has(m.producerId)) return;

                if (!deviceRef.current || !recvTransportRef.current) {
                    const alreadyQueued = pendingNewProducersRef.current.some(
                        (p) => p.producerId === m.producerId
                    );
                    if (!alreadyQueued) {
                        pendingNewProducersRef.current.push({
                            userId: m.userId,
                            producerId: m.producerId,
                        });
                    }
                    return;
                }

                try {
                    await consume(m.userId, m.producerId);
                } catch (err) {
                    console.error("consume (new-producer) failed", err);
                }
                return;
            }

            if (msg.type === "sfu:producer-closed") {
                const m = msg as SfuProducerClosedMsg;

                const managedStream = remoteStreamsRef.current.get(m.userId);
                if (managedStream) {
                    const toRemove = managedStream
                        .getTracks()
                        .filter((track) => (m.kind ? track.kind === m.kind : true));
                    for (const track of toRemove) {
                        managedStream.removeTrack(track);
                        try {
                            track.stop();
                        } catch {
                            /* ignore */
                        }
                    }

                    if (managedStream.getTracks().length === 0) {
                        remoteStreamsRef.current.delete(m.userId);
                        setRemoteStreams((prev) => {
                            if (!prev[m.userId]) return prev;
                            const next = { ...prev };
                            delete next[m.userId];
                            return next;
                        });
                    } else {
                        const uiStream = new MediaStream(managedStream.getTracks());
                        setRemoteStreams((prev) => ({
                            ...prev,
                            [m.userId]: uiStream,
                        }));
                    }
                }

                consumedRef.current.delete(m.producerId);
                return;
            }

            if (msg.type === "sfu:peer-left") {
                const m = msg as SfuPeerLeftMsg;

                const stream = remoteStreamsRef.current.get(m.userId);
                if (stream) {
                    stream.getTracks().forEach((track) => {
                        try {
                            track.stop();
                        } catch {
                            /* ignore */
                        }
                    });
                    remoteStreamsRef.current.delete(m.userId);
                }
                
                // Mikrofon-Status entfernen
                setAudioMuteStatus((prev) => {
                    const next = { ...prev };
                    delete next[m.userId];
                    return next;
                });

                setRemoteStreams((prev) => {
                    if (!prev[m.userId]) return prev;
                    const next = { ...prev };
                    delete next[m.userId];
                    return next;
                });
                for (const [producerId, ownerId] of consumedRef.current.entries()) {
                    if (ownerId === m.userId) consumedRef.current.delete(producerId);
                }
                return;
            }
        };

        socket.addEventListener("message", onMessage);
        return () => socket.removeEventListener("message", onMessage);
    }, [socket, consume]);

    const stopScreenShare = useCallback(() => {
        const screenStream = screenStreamRef.current;
        if (screenStream) {
            screenStream.getTracks().forEach((t) => {
                try { t.stop(); } catch { /* ignore */ }
            });
            screenStreamRef.current = null;
            setLocalScreenStream(null);
        }

        const producer = screenProducerRef.current;
        if (producer) {
            try { producer.close(); } catch { /* ignore */ }
            screenProducerRef.current = null;
        }

        setIsScreenSharing(false);
    }, []);

    const startScreenShare = useCallback(async () => {
        const sendTransport = sendTransportRef.current;
        const device = deviceRef.current;

        if (!sendTransport || !device) {
            console.warn("startScreenShare: kein sendTransport oder Device");
            return;
        }

        if (screenProducerRef.current) {
            console.warn("startScreenShare: bereits aktiv");
            return;
        }

        if (!device.canProduce("video")) {
            console.warn("startScreenShare: device.canProduce('video') = false");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true
            });

            const track = stream.getVideoTracks()[0];
            if (!track) {
                console.warn("startScreenShare: kein Video-Track");
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            screenStreamRef.current = stream;
            setLocalScreenStream(stream);
            track.onended = () => {
                console.log("Screen track ended -> stopScreenShare()");
                stopScreenShare();
            };

            const producer = await sendTransport.produce({
                track,
                // Markiere Screen-Sharing für serverseitige Validierung
                appData: { mediaTag: "screen", source: "screen" },
            });

            screenProducerRef.current = producer;
            setIsScreenSharing(true);
        } catch (e) {
            console.error("startScreenShare failed:", e);
        }
    }, [stopScreenShare]);

    // ----- Join + Device init
    useEffect(() => {
        if (!userId || !conferenceId) return;

        const key = `${conferenceId}|${userId}`;
        if (initKeyRef.current === key) return;
        initKeyRef.current = key;

        let mounted = true;

        (async () => {
            const wantSend = role !== "VIEWER";

            // 1) join
            const joinRes = await request<SfuJoinRes>("sfu:join", { role });
            if (!mounted) return;

            const device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: joinRes.routerRtpCapabilities });
            deviceRef.current = device;

            // 2) recv transport
            const recvOpts = await request<SfuCreateTransportRes>("sfu:create-transport", {
                direction: "recv" as TransportDirection,
            });
            if (!mounted)
                return;

            const recvTransport = device.createRecvTransport({
                ...recvOpts,
                iceServers,
            });

            recvTransport.on("connectionstatechange", (state) => {
                if (state === "failed" || state === "disconnected" || state === "closed") {
                    console.error("recvTransport state:", state);
                }
            });

            recvTransport.on("connect", ({ dtlsParameters }, cb, errCb) => {
                request<null>("sfu:connect-transport", {
                    transportId: recvTransport.id,
                    dtlsParameters: dtlsParameters as DtlsParameters,
                })
                    .then(() => cb())
                    .catch((e) => {
                        console.error("recvTransport DTLS connect failed", e);
                        errCb(e);
                    });
            });

            recvTransportRef.current = recvTransport;

            await processPendingNewProducers();

            // 3) send transport + local media
            if (wantSend) {
                const sendOpts = await request<SfuCreateTransportRes>("sfu:create-transport", {
                    direction: "send" as TransportDirection,
                });
                if (!mounted) return;

                const sendTransport = device.createSendTransport({
                    ...sendOpts,
                    iceServers,
                });

                sendTransport.on("connectionstatechange", (state) => {
                    if (state === "failed" || state === "disconnected" || state === "closed") {
                        console.error("sendTransport state:", state);
                    }
                });

                sendTransport.on("connect", ({ dtlsParameters }, cb, errCb) => {
                    request<null>("sfu:connect-transport", {
                        transportId: sendTransport.id,
                        dtlsParameters: dtlsParameters as DtlsParameters,
                    })
                        .then(() => cb())
                        .catch((e) => {
                            console.error("sendTransport DTLS connect failed", e);
                            errCb(e);
                        });
                });

                sendTransport.on("produce", ({ kind, rtpParameters, appData }, cb, errCb) => {
                    request<{ id: string }>("sfu:produce", {
                        transportId: sendTransport.id,
                        kind,
                        rtpParameters: rtpParameters as RtpParameters,
                        appData,
                    })
                        .then(({ id }) => cb({ id }))
                        .catch((e) => {
                            console.error("produce server error", e);
                            errCb(e);
                        });
                });

                sendTransportRef.current = sendTransport;

                let stream: MediaStream | null;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                } catch (e) {
                    console.error("getUserMedia failed:", e);
                    stream = null;
                }

                setLocalStream(stream);

                if (stream) {
                    const vTrack = stream.getVideoTracks()[0];
                    const aTrack = stream.getAudioTracks()[0];

                    try {
                        if (vTrack && device.canProduce("video")) {
                            await sendTransport.produce({ 
                                track: vTrack,
                                encodings: [{
                                    maxBitrate: 1_500_000,
                                    maxFramerate: 30,
                                    scalabilityMode: "L1T1"
                                }],
                                codecOptions: {
                                    videoGoogleStartBitrate: 1000
                                },
                                appData: { mediaTag: "cam" }
                            });
                        }
                        if (aTrack && device.canProduce("audio")) {
                            await sendTransport.produce({ track: aTrack });
                        }
                    } catch (e) {
                        console.error("produce failed:", e);
                    }
                }
            }

            // 4) existierende Producer consummen
            for (const p of joinRes.existingProducers) {
                try {
                    await consume(p.userId, p.producerId);
                } catch (err) {
                    console.error("failed to consume existing producer", err);
                }
            }

            await processPendingNewProducers();
        })().catch((e) => {
            console.error("SFU init failed:", e);
        });

        return () => {
            mounted = false;
            initKeyRef.current = null;
            sendTransportRef.current?.close();
            recvTransportRef.current?.close();
            sendTransportRef.current = null;
            recvTransportRef.current = null;
            deviceRef.current = null;

            const screenStream = screenStreamRef.current;
            if (screenStream) {
                screenStream.getTracks().forEach((t) => {
                    try { t.stop(); } catch { /* ignore */ }
                });
                screenStreamRef.current = null;
                setLocalScreenStream(null);
            }
            if (screenProducerRef.current) {
                try { screenProducerRef.current.close(); } catch { /* ignore */ }
                screenProducerRef.current = null;
            }
            setIsScreenSharing(false);

            const remoteStreams = remoteStreamsRef.current;
            remoteStreams.forEach((stream) => {
                stream.getTracks().forEach((track) => {
                    try {
                        track.stop();
                    } catch {
                        /* ignore */
                    }
                });
            });
            remoteStreamsRef.current.clear();

            setRemoteStreams({});
            setLocalStream((s) => {
                s?.getTracks().forEach((t) => t.stop());
                return null;
            });
            const consumed = consumedRef.current;
            consumed.clear();
            pendingNewProducersRef.current = [];

            request<null>("sfu:leave").catch(() => {});
        };
    }, [userId, conferenceId, role, consume, request, processPendingNewProducers, iceServers]);

    // Lokalen Mikrofon-Status tracken
    useEffect(() => {
        if (!localStream) {
            setAudioMuteStatus((prev) => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
            return;
        }

        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length === 0) {
            setAudioMuteStatus((prev) => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
            return;
        }

        const updateLocalMuteStatus = () => {
            const isMuted = audioTracks.every(track => track.muted || !track.enabled);
            setAudioMuteStatus((prev) => ({
                ...prev,
                [userId]: isMuted,
            }));
        };

        updateLocalMuteStatus();
        audioTracks.forEach(track => {
            track.onmute = updateLocalMuteStatus;
            track.onunmute = updateLocalMuteStatus;
        });

        return () => {
            audioTracks.forEach(track => {
                track.onmute = null;
                track.onunmute = null;
            });
        };
    }, [localStream, userId]);

    return {
        localStream,
        remoteStreams,
        startScreenShare,
        stopScreenShare,
        isScreenSharing,
        localScreenStream,
        audioMuteStatus
    };
}