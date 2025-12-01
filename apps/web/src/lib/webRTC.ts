import { useCallback, useEffect, useRef, useState } from "react";
import * as mediasoupClient from "mediasoup-client";

type Role = "ORGANIZER" | "PARTICIPANT" | "VIEWER";

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
    userId: string; // von wem
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
    kind: mediasoupClient.types.MediaKind; // "audio" | "video"
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

    const initKeyRef = useRef<string | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);

    const pendingRef = useRef<Map<string, Pending<unknown>>>(new Map());
    const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
    const pendingNewProducersRef = useRef<Array<{ userId: string; producerId: string; kind?: string }>>([]);

    // refs für aktuelle Werte
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
    }, []); // ✅ keine deps mehr

    const iceServers = [
        {urls: process.env.NEXT_PUBLIC_STUN_URL!},
    ];

    // ----- consume helper
    const consumedRef = useRef<Map<string, string>>(new Map());

    const consume = useCallback(async (fromUserId: string, producerId: string) => {
        console.log("🎯🎯🎯 consume() CALLED", { fromUserId, producerId, stack: new Error().stack });
        const device = deviceRef.current;
        const recvTransport = recvTransportRef.current;
        console.log("🔍 consume() device/transport check", { 
            device: !!device, 
            recvTransport: !!recvTransport,
            deviceRtpCapabilities: device?.rtpCapabilities ? "present" : "missing",
            recvTransportId: recvTransport?.id,
        });
        if (!device || !recvTransport) {
            console.warn("⚠️⚠️⚠️ consume() EARLY RETURN: device or recvTransport missing", { device: !!device, recvTransport: !!recvTransport });
            return;
        }

        // WICHTIG: Prüfe ob bereits konsumiert, aber setze consumedRef erst NACH erfolgreichem Consumer erstellen
        if (consumedRef.current.has(producerId)) {
            console.log("⏭️ stale/duplicate producer, skip", producerId, "already consumed for", consumedRef.current.get(producerId));
            return;
        }
        
        console.log("✅ consume() proceeding", { fromUserId, producerId });

        try {
            // WICHTIG: Stelle sicher, dass der Transport verbunden ist, bevor wir consume() aufrufen
            // In Mediasoup verbindet sich der Transport automatisch, wenn consume() aufgerufen wird,
            // aber manchmal muss man explizit warten, bis der Transport bereit ist
            if (recvTransport.connectionState === "new" || recvTransport.connectionState === "connecting") {
                console.log("⏳ recvTransport not ready for consume, waiting for connection...", recvTransport.connectionState);
                // Der Transport sollte sich automatisch verbinden, wenn consume() aufgerufen wird
                // Aber wir warten kurz, damit ICE-Kandidaten gesammelt werden können
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
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
            
            // WICHTIG: Setze consumedRef erst NACH erfolgreichem Consumer erstellen
            consumedRef.current.set(producerId, fromUserId);
            console.log("✅ Consumer created, marked as consumed", { producerId, fromUserId });
            
            // Nach consume() sollte der Transport sich verbinden
            console.log("🔍 Transport state after consume()", {
                connectionState: recvTransport.connectionState,
                // eslint-disable-next-line
                iceState: (recvTransport as any).iceState,
            });
            
            // Warte, bis der Transport sich verbindet (falls er sich noch nicht verbunden hat)
            if (recvTransport.connectionState !== "connected") {
                console.log("⏳ Waiting for transport to connect after consume()...", recvTransport.connectionState);
                await new Promise<void>((resolve) => {
                    const timeout = setTimeout(() => {
                        console.warn("⚠️ Transport did not connect after consume() within 3s", recvTransport.connectionState);
                        resolve();
                    }, 3000);
                    
                    const handler = (state: string) => {
                        console.log("🔄 Transport connection state changed after consume()", state);
                        if (state === "connected") {
                            clearTimeout(timeout);
                            recvTransport.off("connectionstatechange", handler);
                            resolve();
                        } else if (state === "failed" || state === "disconnected" || state === "closed") {
                            clearTimeout(timeout);
                            recvTransport.off("connectionstatechange", handler);
                            console.error("❌ Transport connection failed after consume()", state);
                            resolve();
                        }
                    };
                    
                    recvTransport.on("connectionstatechange", handler);
                    
                    // Prüfe nochmal, falls es sich zwischenzeitlich geändert hat
                    if (recvTransport.connectionState === "connected") {
                        clearTimeout(timeout);
                        recvTransport.off("connectionstatechange", handler);
                        resolve();
                    }
                });
            }
            
            console.log("✅ Transport ready for track", {
                connectionState: recvTransport.connectionState,
            });

            const track = consumer.track;
            
            // Stelle sicher, dass der Track enabled ist
            if (!track.enabled) {
                track.enabled = true;
                console.log("🔧 Track was disabled, enabled it", { kind: track.kind, producerId });
            }
            
            console.log("🎬 Consumer track created", {
                kind: track.kind,
                id: track.id,
                muted: track.muted,
                readyState: track.readyState,
                enabled: track.enabled,
                fromUserId,
                producerId,
            });

            // Resume consumer auf Server und Client
            await request<null>("sfu:resume-consumer", { consumerId: consumer.id });

            try {
                await consumer.resume();
                console.log("✅ Consumer resumed", { 
                    kind: track.kind, 
                    producerId,
                    consumerPaused: consumer.paused,
                    trackMuted: track.muted,
                    trackEnabled: track.enabled,
                    trackReadyState: track.readyState,
                });
            } catch (err) {
                console.warn("⚠️ Consumer resume failed", err);
            }
            
            // Prüfe Transport-Status
            console.log("🔍 Transport status", {
                recvTransportId: recvTransport.id,
                recvTransportConnectionState: recvTransport.connectionState,
                // eslint-disable-next-line
                recvTransportState: (recvTransport as any).state,
            });
            
            // WICHTIG: Warte, bis der Transport verbunden ist, bevor wir den Track hinzufügen
            if (recvTransport.connectionState !== "connected") {
                console.log("⏳ Transport not connected yet, waiting...", recvTransport.connectionState);
                
                // Warte auf connectionstatechange Event
                await new Promise<void>((resolve) => {
                    const timeout = setTimeout(() => {
                        console.warn("⚠️ Transport connection timeout after 5s", recvTransport.connectionState);
                        resolve();
                    }, 5000);
                    
                    const handler = (state: string) => {
                        console.log("🔄 Transport connection state changed", state);
                        if (state === "connected") {
                            clearTimeout(timeout);
                            recvTransport.off("connectionstatechange", handler);
                            resolve();
                        }
                    };
                    
                    recvTransport.on("connectionstatechange", handler);
                    
                    // Prüfe nochmal, falls es sich zwischenzeitlich geändert hat
                    if (recvTransport.connectionState === "connected") {
                        clearTimeout(timeout);
                        recvTransport.off("connectionstatechange", handler);
                        resolve();
                    }
                });
            }
            
            console.log("✅ Transport connection state", recvTransport.connectionState);
            
            // Warte kurz, damit der Track Zeit hat, Frames zu empfangen
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Prüfe nochmal den Track-Status
            console.log("🔍 Track status after resume and transport wait", {
                kind: track.kind,
                muted: track.muted,
                enabled: track.enabled,
                readyState: track.readyState,
                consumerPaused: consumer.paused,
                transportState: recvTransport.connectionState,
            });

            const applyTrack = () => {
                let managedStream = remoteStreamsRef.current.get(fromUserId);
                if (!managedStream) {
                    managedStream = new MediaStream();
                    remoteStreamsRef.current.set(fromUserId, managedStream);
                }

                const existing = managedStream.getTracks().filter((t) => t.kind === track.kind);
                for (const existingTrack of existing) {
                    managedStream.removeTrack(existingTrack);
                    try {
                        existingTrack.stop();
                    } catch {
                        // ignore
                    }
                }

                managedStream.addTrack(track);
                
                // Stelle sicher, dass der Track wirklich unmuted ist
                // WICHTIG: Mediasoup-Tracks können initial gemuted sein, bis der Transport verbunden ist
                if (track.muted) {
                    console.warn("⚠️ Track is muted after adding to stream", { 
                        kind: track.kind, 
                        producerId,
                        transportState: recvTransport.connectionState,
                    });
                    // Track.muted ist read-only, wir können es nicht direkt setzen
                    // Es sollte automatisch unmuten, wenn der Transport verbunden ist und Frames ankommen
                    
                    // Setze einen Listener, der den Stream aktualisiert, wenn der Track unmuted wird
                    track.onunmute = () => {
                        console.log("🔊 Track unmuted after transport connection!", { kind: track.kind, producerId });
                        track.onunmute = null;
                        // Aktualisiere den Stream, um React zu triggern
                        const currentStream = remoteStreamsRef.current.get(fromUserId);
                        if (currentStream) {
                            const uiStream = new MediaStream(currentStream.getTracks());
                            setRemoteStreams((prev) => ({
                                ...prev,
                                [fromUserId]: uiStream,
                            }));
                        }
                    };
                }
                
                console.log("➕ Track added to stream", {
                    kind: track.kind,
                    trackId: track.id,
                    trackMuted: track.muted,
                    trackEnabled: track.enabled,
                    trackReadyState: track.readyState,
                    streamTracks: managedStream.getTracks().map(t => ({ kind: t.kind, id: t.id, muted: t.muted, readyState: t.readyState })),
                });

                // Clone stream für React state update
                const uiStream = new MediaStream(managedStream.getTracks());
                
                // Prüfe nochmal nach dem Klonen
                const clonedTracks = uiStream.getTracks();
                for (const t of clonedTracks) {
                    if (t.id === track.id && t.muted) {
                        console.warn("⚠️ Track is muted in cloned stream!", { kind: t.kind, id: t.id });
                    }
                }
                
                console.log("🔄 Updating remoteStreams state", {
                    fromUserId,
                    trackCount: uiStream.getTracks().length,
                    tracks: uiStream.getTracks().map(t => ({ kind: t.kind, id: t.id, muted: t.muted, enabled: t.enabled, readyState: t.readyState })),
                });
                setRemoteStreams((prev) => {
                    const next = {
                        ...prev,
                        [fromUserId]: uiStream,
                    };
                    console.log("📊 remoteStreams state after update:", Object.keys(next));
                    return next;
                });
            };

            // Warte auf unmute, wenn der Track gemuted ist
            if (track.muted) {
                console.log("⏳ Track is muted, waiting for unmute...",
                    { kind: track.kind, producerId });
                let applied = false;
                track.onunmute = () => {
                    console.log("🔊 Track unmuted!", { kind: track.kind, producerId, readyState: track.readyState });
                    track.onunmute = null;
                    if (!applied) {
                        applied = true;
                        applyTrack();
                    }
                };
                // Fallback: Wenn nach 3 Sekunden immer noch gemuted, trotzdem hinzufügen
                setTimeout(() => {
                    if (!applied) {
                        const stream = remoteStreamsRef.current.get(fromUserId);
                        const alreadyAdded = stream?.getTracks().some(t => t.id === track.id);
                        if (!alreadyAdded) {
                            console.warn("⚠️ Track still muted after 3s, applying anyway", { kind: track.kind, producerId, muted: track.muted });
                            applied = true;
                            applyTrack();
                        }
                    }
                }, 3000);
            } else {
                console.log("✅ Track not muted, applying immediately", { kind: track.kind, producerId });
                applyTrack();
            }
        } catch (e) {
            consumedRef.current.delete(producerId);
            if (String(e).includes("cannot-consume")) {
                console.warn("stale producer, ignore", producerId);
                return;
            }
            throw e;
        }
    }, [request]);
    
    // Verarbeite pending new-producer Nachrichten
    const processPendingNewProducers = useCallback(async () => {
        if (!deviceRef.current || !recvTransportRef.current) return;
        
        const queue = pendingNewProducersRef.current;
        if (queue.length === 0) return;
        
        console.log("🔄 Processing pending new-producers queue", queue.length);
        const toProcess = [...queue];
        pendingNewProducersRef.current = [];
        
        for (const item of toProcess) {
            // WICHTIG: Prüfe ob bereits konsumiert, bevor wir consume() aufrufen
            if (consumedRef.current.has(item.producerId)) {
                console.log("⏭️ Pending producer already consumed, skipping", {
                    producerId: item.producerId,
                    userId: item.userId,
                    consumedFor: consumedRef.current.get(item.producerId),
                });
                continue;
            }
            
            try {
                await consume(item.userId, item.producerId);
                console.log("✅ Processed pending producer", { producerId: item.producerId, userId: item.userId });
            } catch (err) {
                console.error("❌ Failed to process pending new-producer", item, err);
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
                console.error("❌ WS parse failed", e, ev.data);
                return;
            }
            if (!hasType(msgUnknown)) return;
            const msg = msgUnknown as IncomingMsg;

            // 🔥 INCOMING LOG (drosselbar, wenn's zu viel is)
            console.log("⬅️⬅️⬅️ WS msg", msg.type, msg);
            
            // Spezielles Logging für wichtige Nachrichten
            if (msg.type === "sfu:new-producer" || msg.type === "sfu:peer-joined" || msg.type === "sfu:producer-closed" || msg.type === "sfu:peer-left") {
                console.log("🔥🔥🔥 IMPORTANT SFU EVENT:", msg.type, JSON.stringify(msg, null, 2));
            }

            if (msg.type === "sfu:response") {
                const r = msg as SfuResponseMsg<unknown>;
                const p = pendingRef.current.get(r.responseId);

                if (!p) {
                    console.warn("⚠️ response without pending request", r.responseId);
                    return;
                }

                pendingRef.current.delete(r.responseId);

                if (r.ok) {
                    console.log("✅ SFU response OK", r.responseId, r.data);
                    p.resolve(r.data);
                } else {
                    console.error("❌ SFU response ERR", r.responseId, r.error);
                    p.reject(new Error(r.error ?? "SFU request failed"));
                }
                return;
            }

            if (msg.type === "sfu:new-producer") {
                const m = msg as SfuNewProducerMsg;
                console.log("📥📥📥 NEW-PRODUCER MESSAGE RECEIVED", { 
                    from: m.userId, 
                    producerId: m.producerId,
                    // eslint-disable-next-line
                    kind: (msg as any).kind,
                    fullMsg: msg,
                });
                
                // WICHTIG: Prüfe ob bereits konsumiert, bevor wir etwas tun
                if (consumedRef.current.has(m.producerId)) {
                    console.log("⏭️ Producer already consumed, skipping", {
                        producerId: m.producerId,
                        userId: m.userId,
                        consumedFor: consumedRef.current.get(m.producerId),
                    });
                    return;
                }
                
                // Prüfe ob recvTransport bereit ist
                if (!deviceRef.current || !recvTransportRef.current) {
                    console.log("⏳ recvTransport not ready yet, queuing new-producer", {
                        device: !!deviceRef.current,
                        recvTransport: !!recvTransportRef.current,
                    });
                    // WICHTIG: Prüfe nochmal, ob nicht bereits in der Queue
                    const alreadyQueued = pendingNewProducersRef.current.some(
                        p => p.producerId === m.producerId
                    );
                    if (!alreadyQueued) {
                        pendingNewProducersRef.current.push({
                            userId: m.userId,
                            producerId: m.producerId,
                            // eslint-disable-next-line
                            kind: (msg as any).kind,
                        });
                    } else {
                        console.log("⏭️ Producer already in queue, skipping", { producerId: m.producerId });
                    }
                    return;
                }
                
                console.log("🔍 About to call consume()", {
                    device: !!deviceRef.current,
                    recvTransport: !!recvTransportRef.current,
                });
                try {
                    await consume(m.userId, m.producerId);
                    console.log("✅✅✅ consume completed for", { from: m.userId, producerId: m.producerId });
                } catch (err) {
                    console.error("❌❌❌ consume failed for", { from: m.userId, producerId: m.producerId }, err);
                }
                return;
            }

            if (msg.type === "sfu:producer-closed") {
                const m = msg as SfuProducerClosedMsg;
                console.log("🛑 producer-closed", m);

                const managedStream = remoteStreamsRef.current.get(m.userId);
                if (managedStream) {
                    const toRemove = managedStream.getTracks().filter((track) =>
                        m.kind ? track.kind === m.kind : true
                    );
                    for (const track of toRemove) {
                        managedStream.removeTrack(track);
                        try {
                            track.stop();
                        } catch {
                            // ignore
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

            if (msg.type === "sfu:peer-joined") {
                const m = msg as { type: "sfu:peer-joined"; userId: string };
                console.log("👋👋👋 PEER-JOINED", m.userId, "but not consuming yet - waiting for sfu:new-producer");
                return;
            }

            if (msg.type === "sfu:peer-left") {
                const m = msg as SfuPeerLeftMsg;
                console.log("👋 peer-left", m.userId);

                const stream = remoteStreamsRef.current.get(m.userId);
                if (stream) {
                    stream.getTracks().forEach((track) => {
                        try {
                            track.stop();
                        } catch {
                            // ignore
                        }
                    });
                    remoteStreamsRef.current.delete(m.userId);
                }

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

    // ----- Join + Device init
    useEffect(() => {
        if (!userId || !conferenceId) return;

        const key = `${conferenceId}|${userId}`;
        if (initKeyRef.current === key) return;
        initKeyRef.current = key;

        let mounted = true;

        (async () => {
            const wantSend = role !== "VIEWER";
            console.log("🚪 init WebRTC", { userId, conferenceId, role, wantSend });

            // 1) join
            const joinRes = await request<SfuJoinRes>("sfu:join", { role });
            if (!mounted) return;

            console.log("✅ joinRes", joinRes);
            console.log("📦 existingProducers", joinRes.existingProducers);

            const device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: joinRes.routerRtpCapabilities });
            deviceRef.current = device;

            console.log("✅ device loaded", {
                rtpCapabilities: device.rtpCapabilities,
                canAudio: device.canProduce("audio"),
                canVideo: device.canProduce("video"),
            });

            // 2) recv transport
            const recvOpts = await request<SfuCreateTransportRes>("sfu:create-transport", {
                direction: "recv" as TransportDirection,
            });
            if (!mounted) return;

            console.log("✅ recv transport opts", recvOpts);

            const recvTransport = device.createRecvTransport({
                ...recvOpts,
                iceServers,
            });

            // 🔥 Transport State Logs
            recvTransport.on("connectionstatechange", (state) =>
                console.log("🟦 recvTransport state:", state)
            );
            // eslint-disable-next-line
            recvTransport.on("icegatheringstatechange" as any, (state: any) =>
                console.log("🟦 recv ICE gathering:", state)
            );
            // eslint-disable-next-line
            recvTransport.on("icestatechange" as any, (state: any) =>
                console.log("🟦 recv ICE state:", state)
            );

            recvTransport.on("connect", ({ dtlsParameters }, cb, errCb) => {
                console.log("🟦 recvTransport connect() → sending DTLS", {
                    transportId: recvTransport.id,
                    connectionState: recvTransport.connectionState,
                });
                request<null>("sfu:connect-transport", {
                    transportId: recvTransport.id,
                    dtlsParameters: dtlsParameters as DtlsParameters,
                })
                    .then(() => {
                        console.log("🟦 recvTransport DTLS OK", {
                            transportId: recvTransport.id,
                            connectionState: recvTransport.connectionState,
                        });
                        cb();
                        // Prüfe den Status nach dem Callback
                        setTimeout(() => {
                            console.log("🔍 recvTransport state after DTLS callback", {
                                transportId: recvTransport.id,
                                connectionState: recvTransport.connectionState,
                            });
                        }, 100);
                    })
                    .catch((e) => {
                        console.error("🟥 recvTransport DTLS FAIL", e);
                        errCb(e);
                    });
            });

            recvTransportRef.current = recvTransport;
            
            // WICHTIG: Versuche den recvTransport zu verbinden, falls er sich nicht automatisch verbindet
            // In Mediasoup verbindet sich der Transport normalerweise automatisch, wenn consume() aufgerufen wird,
            // aber manchmal muss man explizit connect() aufrufen
            if (recvTransport.connectionState === "new") {
                console.log("🔌 recvTransport is 'new', attempting to trigger connection...");
                // Der Transport sollte sich automatisch verbinden, wenn consume() aufgerufen wird
                // Aber wir können auch explizit versuchen, ihn zu verbinden
                // (Mediasoup verbindet sich automatisch, wenn nötig)
            }
            
            // Verarbeite alle pending new-producer Nachrichten, die vorher ankamen
            await processPendingNewProducers();

            // 3) send transport + local media
            if (wantSend) {
                const sendOpts = await request<SfuCreateTransportRes>("sfu:create-transport", {
                    direction: "send" as TransportDirection,
                });
                if (!mounted) return;

                console.log("✅ send transport opts", sendOpts);

                const sendTransport = device.createSendTransport({
                    ...sendOpts,
                    iceServers
                });

                // 🔥 Transport State Logs
                sendTransport.on("connectionstatechange", (state) =>
                    console.log("🟥 sendTransport state:", state)
                );
                // eslint-disable-next-line
                sendTransport.on("icegatheringstatechange" as any, (state: any) =>
                    console.log("🟥 send ICE gathering:", state)
                );
                // eslint-disable-next-line
                sendTransport.on("icestatechange" as any, (state: any) =>
                    console.log("🟥 send ICE state:", state)
                );

                sendTransport.on("connect", ({ dtlsParameters }, cb, errCb) => {
                    console.log("🟥 sendTransport connect() → sending DTLS");
                    request<null>("sfu:connect-transport", {
                        transportId: sendTransport.id,
                        dtlsParameters: dtlsParameters as DtlsParameters,
                    })
                        .then(() => {
                            console.log("🟥 sendTransport DTLS OK");
                            cb();
                        })
                        .catch((e) => {
                            console.error("🟥 sendTransport DTLS FAIL", e);
                            errCb(e);
                        });
                });

                sendTransport.on("produce", ({ kind, rtpParameters }, cb, errCb) => {
                    console.log("🎙️ produce() event", { kind, rtpParameters });

                    request<{ id: string }>("sfu:produce", {
                        transportId: sendTransport.id,
                        kind,
                        rtpParameters: rtpParameters as RtpParameters,
                    })
                        .then(({ id }) => {
                            console.log("✅ produce acknowledged by server", { kind, id });
                            cb({ id });
                        })
                        .catch((e) => {
                            console.error("❌ produce server error", e);
                            errCb(e);
                        });
                });

                sendTransportRef.current = sendTransport;

                let stream: MediaStream | null = null;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
                    console.log("✅ getUserMedia OK", stream.getTracks().map((t) => t.kind));
                } catch (e) {
                    console.error("❌ getUserMedia failed:", e);
                    stream = null;
                }
                if (!mounted) return;
                setLocalStream(stream);

                if (stream) {
                    const vTrack = stream.getVideoTracks()[0];
                    const aTrack = stream.getAudioTracks()[0];

                    try {
                        if (vTrack && device.canProduce("video")) {
                            console.log("📤 producing video track");
                            await sendTransport.produce({ track: vTrack });
                            console.log("✅ produced video");
                        }
                        if (aTrack && device.canProduce("audio")) {
                            console.log("📤 producing audio track");
                            await sendTransport.produce({ track: aTrack });
                            console.log("✅ produced audio");
                        }
                    } catch (e) {
                        console.error("❌ produce failed:", e);
                    }
                }
            }

            // 4) existierende Producer consummen
            console.log("📋 Processing existingProducers", {
                count: joinRes.existingProducers.length,
                producers: joinRes.existingProducers,
                device: !!deviceRef.current,
                recvTransport: !!recvTransportRef.current,
            });
            for (const p of joinRes.existingProducers) {
                console.log("⏳ consuming existing producer", p);
                try {
                    await consume(p.userId, p.producerId);
                    console.log("✅ consumed existing producer", p);
                } catch (err) {
                    console.error("❌ failed to consume existing producer", p, err);
                }
            }
            console.log("✅ Finished processing existingProducers", {
                consumedCount: consumedRef.current.size,
                consumed: Array.from(consumedRef.current.entries()),
            });
            
            // Verarbeite nochmal alle pending new-producer Nachrichten (falls welche dazwischen kamen)
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

            remoteStreamsRef.current.forEach((stream) => {
                stream.getTracks().forEach((track) => {
                    try {
                        track.stop();
                    } catch {
                        // ignore
                    }
                });
            });
            remoteStreamsRef.current.clear();

            setRemoteStreams({});
            setLocalStream(s => { s?.getTracks().forEach(t => t.stop()); return null; });
            consumedRef.current.clear();
            pendingNewProducersRef.current = [];

            request<null>("sfu:leave").catch(() => {});
        };
    }, [userId, conferenceId, role, consume, request, processPendingNewProducers]);

    // 🔍 DIAGNOSE: Funktion zum Debuggen - kann in Browser-Konsole aufgerufen werden
    const diagnose = useCallback(async () => {
        // eslint-disable-next-line
        const report: any = {
            timestamp: new Date().toISOString(),
            device: deviceRef.current ? {
                loaded: true,
                rtpCapabilities: deviceRef.current.rtpCapabilities ? "present" : "missing",
            } : { loaded: false },
            transports: {},
            remoteStreams: {},
        };

        // Recv Transport
        const recvTransport = recvTransportRef.current;
        if (recvTransport) {
            try {
                const stats = await recvTransport.getStats();
                report.transports.recv = {
                    id: recvTransport.id,
                    connectionState: recvTransport.connectionState,
                    // eslint-disable-next-line
                    iceState: (recvTransport as any).iceState,
                    // eslint-disable-next-line
                    iceSelectedTuple: (recvTransport as any).iceSelectedTuple,
                    // eslint-disable-next-line
                    dtlsState: (recvTransport as any).dtlsState,
                    stats: stats,
                };
            } catch (e) {
                report.transports.recv = { error: String(e) };
            }
        } else {
            report.transports.recv = { error: "not initialized" };
        }

        // Send Transport
        const sendTransport = sendTransportRef.current;
        if (sendTransport) {
            try {
                const stats = await sendTransport.getStats();
                report.transports.send = {
                    id: sendTransport.id,
                    connectionState: sendTransport.connectionState,
                    // eslint-disable-next-line
                    iceState: (sendTransport as any).iceState,
                    // eslint-disable-next-line
                    iceSelectedTuple: (sendTransport as any).iceSelectedTuple,
                    // eslint-disable-next-line
                    dtlsState: (sendTransport as any).dtlsState,
                    stats: stats,
                };
            } catch (e) {
                report.transports.send = { error: String(e) };
            }
        } else {
            report.transports.send = { error: "not initialized" };
        }

        // Remote Streams
        for (const [userId, stream] of Object.entries(remoteStreams)) {
            const tracks = stream.getTracks();
            report.remoteStreams[userId] = {
                streamId: stream.id,
                trackCount: tracks.length,
                tracks: tracks.map(track => ({
                    id: track.id,
                    kind: track.kind,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState,
                })),
            };
        }

        console.group("🔍 WebRTC DIAGNOSE REPORT");
        console.log("📊 Full Report:", report);
        
        // Kritische Checks
        console.group("🚨 CRITICAL CHECKS");
        if (recvTransport) {
            if (recvTransport.connectionState !== "connected") {
                console.error("❌ recvTransport NOT CONNECTED:", recvTransport.connectionState);
            } else {
                console.log("✅ recvTransport is connected");
            }
            // eslint-disable-next-line
            if ((recvTransport as any).dtlsState !== "connected") {
                // eslint-disable-next-line
                console.error("❌ recvTransport DTLS NOT CONNECTED:", (recvTransport as any).dtlsState);
            } else {
                console.log("✅ recvTransport DTLS is connected");
            }
        } else {
            console.error("❌ recvTransport not initialized");
        }

        const remoteStreamCount = Object.keys(remoteStreams).length;
        if (remoteStreamCount === 0) {
            console.warn("⚠️ No remote streams");
        } else {
            console.log(`✅ ${remoteStreamCount} remote stream(s)`);
        }

        for (const [userId, streamInfo] of Object.entries(report.remoteStreams)) {
            // eslint-disable-next-line
            const videoTracks = (streamInfo as any).tracks.filter((t: any) => t.kind === "video");
            for (const track of videoTracks) {
                if (track.muted) {
                    console.warn(`⚠️ Video track muted for user ${userId}`);
                }
                if (track.readyState !== "live") {
                    console.warn(`⚠️ Video track not live for user ${userId}:`, track.readyState);
                }
            }
        }
        console.groupEnd();
        console.groupEnd();

        return report;
    }, [remoteStreams]);

    // Expose diagnose function globally for console access
    if (typeof window !== "undefined") {
        // eslint-disable-next-line
        (window as any).webrtcDiagnose = diagnose;
    }

    return { localStream, remoteStreams, diagnose };
}
