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


    // ----- consume helper
    const consumedRef = useRef<Set<string>>(new Set());

    const consume = useCallback(async (fromUserId: string, producerId: string) => {
        const device = deviceRef.current;
        const recvTransport = recvTransportRef.current;
        if (!device || !recvTransport) return;

        if (consumedRef.current.has(producerId)) {
            console.log("⏭️ stale/duplicate producer, skip", producerId);
            return;
        }
        consumedRef.current.add(producerId);

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

            setRemoteStreams(prev => {
                const old = prev[fromUserId];
                const newStream = new MediaStream(old ? old.getTracks() : []);
                for (const t of newStream.getTracks()) {
                    if (t.kind === consumer.track.kind) newStream.removeTrack(t);
                }
                newStream.addTrack(consumer.track);
                return { ...prev, [fromUserId]: newStream };
            });

            await request<null>("sfu:resume-consumer", { consumerId: consumer.id });
        } catch (e) {
            consumedRef.current.delete(producerId);
            if (String(e).includes("cannot-consume")) {
                console.warn("stale producer, ignore", producerId);
                return;
            }
            throw e;
        }
    }, [request]);

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

            // 🔥 INCOMING LOG (drosselbar, wenn’s zu viel is)
            console.log("⬅️ WS msg", msg);

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
                console.log("📥 new-producer", { from: m.userId, producerId: m.producerId });
                await consume(m.userId, m.producerId);
                return;
            }

            if (msg.type === "sfu:producer-closed") {
                const m = msg as SfuProducerClosedMsg;
                console.log("🛑 producer-closed", m);

                setRemoteStreams((prev) => {
                    const c = { ...prev };
                    delete c[m.userId];
                    return c;
                });
                return;
            }

            if (msg.type === "sfu:peer-left") {
                const m = msg as SfuPeerLeftMsg;
                console.log("👋 peer-left", m.userId);

                setRemoteStreams((prev) => {
                    const c = { ...prev };
                    delete c[m.userId];
                    return c;
                });
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

            const recvTransport = device.createRecvTransport(recvOpts);

            // 🔥 Transport State Logs
            recvTransport.on("connectionstatechange", (state) =>
                console.log("🟦 recvTransport state:", state)
            );
            recvTransport.on("icegatheringstatechange" as any, (state: any) =>
                console.log("🟦 recv ICE gathering:", state)
            );
            recvTransport.on("icestatechange" as any, (state: any) =>
                console.log("🟦 recv ICE state:", state)
            );

            recvTransport.on("connect", ({ dtlsParameters }, cb, errCb) => {
                console.log("🟦 recvTransport connect() → sending DTLS");
                request<null>("sfu:connect-transport", {
                    transportId: recvTransport.id,
                    dtlsParameters: dtlsParameters as DtlsParameters,
                })
                    .then(() => {
                        console.log("🟦 recvTransport DTLS OK");
                        cb();
                    })
                    .catch((e) => {
                        console.error("🟥 recvTransport DTLS FAIL", e);
                        errCb(e);
                    });
            });

            recvTransportRef.current = recvTransport;

            // 3) send transport + local media
            if (wantSend) {
                const sendOpts = await request<SfuCreateTransportRes>("sfu:create-transport", {
                    direction: "send" as TransportDirection,
                });
                if (!mounted) return;

                console.log("✅ send transport opts", sendOpts);

                const sendTransport = device.createSendTransport(sendOpts);

                // 🔥 Transport State Logs
                sendTransport.on("connectionstatechange", (state) =>
                    console.log("🟥 sendTransport state:", state)
                );
                sendTransport.on("icegatheringstatechange" as any, (state: any) =>
                    console.log("🟥 send ICE gathering:", state)
                );
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
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
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
            for (const p of joinRes.existingProducers) {
                console.log("⏳ consuming existing producer", p);
                await consume(p.userId, p.producerId);
            }
        })().catch((e) => {
            console.error("SFU init failed:", e);
        });

        return () => {
            mounted = false;
            const isDev = process.env.NODE_ENV === "development";
            if (isDev) {
                console.log("🧪 DEV cleanup skipped (StrictMode)");
                return;
            }

            initKeyRef.current = null;
            sendTransportRef.current?.close();
            recvTransportRef.current?.close();
            sendTransportRef.current = null;
            recvTransportRef.current = null;
            deviceRef.current = null;

            setRemoteStreams({});
            setLocalStream(s => { s?.getTracks().forEach(t => t.stop()); return null; });

            request<null>("sfu:leave").catch(() => {});
        };
    }, [userId, conferenceId, role, consume, request]);

    return { localStream, remoteStreams };
}
