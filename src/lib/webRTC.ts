// src/lib/useWebRTC.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "ORGANIZER" | "PARTICIPANT" | "VIEWER";

type SignalSocket = {
    addEventListener: (ev: "message", cb: (ev: MessageEvent) => void) => void;
    removeEventListener: (ev: "message", cb: (ev: MessageEvent) => void) => void;
    readyState: number;
};

type BaseMsg       = { type: string; [k: string]: unknown };
type MsgPeers      = BaseMsg & { type: "webrtc:peers";      conferenceId: string; peers: string[] };
type MsgPeerJoined = BaseMsg & { type: "webrtc:peer-joined"; userId: string };
type MsgPeerLeft   = BaseMsg & { type: "webrtc:peer-left";   userId: string };
type MsgOffer      = BaseMsg & { type: "webrtc:offer";  from: string; to: string; conferenceId: string; sdp: RTCSessionDescriptionInit };
type MsgAnswer     = BaseMsg & { type: "webrtc:answer"; from: string; to: string; conferenceId: string; sdp: RTCSessionDescriptionInit };
type MsgCand       = BaseMsg & { type: "webrtc:candidate"; from: string; to: string; conferenceId: string; candidate: RTCIceCandidateInit };
type MsgUseHls     = BaseMsg & { type: "server:use-hls"; conferenceId: string };

type IncomingMsg =
    | MsgPeers | MsgPeerJoined | MsgPeerLeft
    | MsgOffer | MsgAnswer | MsgCand | MsgUseHls | BaseMsg;

function parseMsg(ev: MessageEvent): IncomingMsg | null {
    try {
        const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
        const obj = JSON.parse(raw) as IncomingMsg;
        return obj && typeof obj === "object" && "type" in obj ? obj : null;
    } catch { return null; }
}

type PeerState = {
    pc: RTCPeerConnection;
    polite: boolean;
    makingOffer: boolean;
    ignoreOffer: boolean;
    pendingCandidates: RTCIceCandidateInit[];
    videoSender: RTCRtpSender;
    audioSender: RTCRtpSender;
    hadVideoTrack: boolean;
    hadAudioTrack: boolean;
    iceRestartTimer?: number;
};

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

    const peers = useRef<Map<string, PeerState>>(new Map());
    const joinedRef = useRef(false);
    const joinedConfRef = useRef<string | null>(null);
    const leaveNowRef = useRef<() => void>(() => {});

    const rtcConfig = useMemo<RTCConfiguration>(
        () => ({
            iceServers: [
                { urls: [process.env.NEXT_PUBLIC_STUN_URL || "stun:stun.l.google.com:19302"] },
                // Tipp für echte Netze: TURN ergänzen
                // { urls: "turn:YOUR_TURN_HOST:3478", username: "user", credential: "pass" },
            ],
        }),
        []
    );

    const stopLocal = useCallback(() => {
        localStream?.getTracks().forEach(t => t.stop());
        setLocalStream(null);
    }, [localStream]);

    const closePeers = useCallback(() => {
        for (const p of peers.current.values()) p.pc.close();
        peers.current.clear();
        setRemoteStreams({});
    }, []);

    const leaveNow = useCallback(() => {
        if (!joinedRef.current || !joinedConfRef.current) return;
        send({ type: "webrtc:leave", userId, conferenceId: joinedConfRef.current });
        closePeers();
        stopLocal();
        joinedRef.current = false;
        joinedConfRef.current = null;
    }, [send, userId, closePeers, stopLocal]);

    // ---- Renegotiation helper -------------------------------------------------
    const renegotiate = useCallback(async (peerId: string, p: PeerState) => {
        if (p.makingOffer || p.pc.signalingState !== "stable") return;
        try {
            p.makingOffer = true;
            await p.pc.setLocalDescription(await p.pc.createOffer());
            send({ type: "webrtc:offer", from: userId, to: peerId, conferenceId, sdp: p.pc.localDescription! });
        } finally {
            p.makingOffer = false;
        }
    }, [send, userId, conferenceId]);

    // lokale Tracks auf feste Sender legen; bei (null<->Track) → renegotiation
    const attachLocalToPeer = useCallback((peerId: string, peer: PeerState, stream: MediaStream | null) => {
        const vTrack = stream?.getVideoTracks()[0] ?? null;
        const aTrack = stream?.getAudioTracks()[0] ?? null;

        const prevV = !!peer.videoSender.track;
        const prevA = !!peer.audioSender.track;

        // Tracks tauschen
        peer.videoSender.replaceTrack(vTrack).catch(() => {});
        peer.audioSender.replaceTrack(aTrack).catch(() => {});

        // WICHTIG: den Sendern den Stream zuordnen -> ev.streams[0] ist dann gesetzt
        if (stream) {
            try { (peer.videoSender as any).setStreams(stream); } catch {}
            try { (peer.audioSender as any).setStreams(stream); } catch {}
        }

        const nowV = !!vTrack, nowA = !!aTrack;
        peer.hadVideoTrack = nowV; peer.hadAudioTrack = nowA;

        if (prevV !== nowV || prevA !== nowA) renegotiate(peerId, peer);
    }, [renegotiate]);

    // Peer anlegen (immer 2 Transceiver in stabiler Reihenfolge)
    const getOrCreatePeer = useCallback((peerId: string) => {
        const existing = peers.current.get(peerId);
        if (existing) return existing;

        const pc = new RTCPeerConnection(rtcConfig);
        const polite = userId.localeCompare(peerId) < 0;
        const pendingCandidates: RTCIceCandidateInit[] = [];

        const tVideo = pc.addTransceiver("video", { direction: "sendrecv" });
        const tAudio = pc.addTransceiver("audio", { direction: "sendrecv" });

        const state: PeerState = {
            pc, polite,
            makingOffer: false,
            ignoreOffer: false,
            pendingCandidates,
            videoSender: tVideo.sender,
            audioSender: tAudio.sender,
            hadVideoTrack: false,
            hadAudioTrack: false,
        };

        // lokale Tracks (falls vorhanden) zuweisen
        attachLocalToPeer(peerId, state, localStream);

        pc.onnegotiationneeded = async () => {
            if (pc.signalingState !== "stable") return;
            try {
                state.makingOffer = true;
                await pc.setLocalDescription(await pc.createOffer());
                send({ type: "webrtc:offer", from: userId, to: peerId, conferenceId, sdp: pc.localDescription! });
            } finally {
                state.makingOffer = false;
            }
        };

        pc.onicecandidate = ev => {
            if (ev.candidate) {
                send({ type: "webrtc:candidate", from: userId, to: peerId, conferenceId, candidate: ev.candidate });
            }
        };

        pc.ontrack = ev => {
            setRemoteStreams(prev => {
                // vorhandenen Stream je Peer wiederverwenden
                const existing = prev[peerId] ?? new MediaStream();
                // bevorzugt den vom Sender benannten Stream nutzen
                const stream = ev.streams[0] ?? existing;

                // Falls kein Stream mitkam -> Track manuell in (neuen/alten) Stream packen
                if (!ev.streams[0]) {
                    // gleichartige alte Tracks raus (Video <-> Video, Audio <-> Audio)
                    for (const t of stream.getTracks()) {
                        if (t.kind === ev.track.kind) stream.removeTrack(t);
                    }
                    stream.addTrack(ev.track);
                }
                return { ...prev, [peerId]: stream };
            });
        };

        // ⚠️ NICHT bei "disconnected" schließen – das ist oft nur transient.
        pc.onconnectionstatechange = () => {
            const st = pc.connectionState;
            if (st === "failed") {
                try { pc.restartIce(); renegotiate(peerId, state); } catch {}
            } else if (st === "closed") {
                peers.current.delete(peerId);
                setRemoteStreams(prev => {
                    const c = { ...prev }; delete c[peerId]; return c;
                });
            }
        };

        // Kleiner Watchdog: bei längerem "disconnected" → ICE-Restart
        pc.oniceconnectionstatechange = () => {
            const s = pc.iceConnectionState;
            if (s === "disconnected") {
                if (state.iceRestartTimer) window.clearTimeout(state.iceRestartTimer);
                state.iceRestartTimer = window.setTimeout(() => {
                    if (pc.iceConnectionState === "disconnected") {
                        try { pc.restartIce(); renegotiate(peerId, state); } catch {}
                    }
                }, 3000);
            } else if (s === "connected" || s === "completed") {
                if (state.iceRestartTimer) window.clearTimeout(state.iceRestartTimer);
                state.iceRestartTimer = undefined;
            } else if (s === "failed") {
                try { pc.restartIce(); renegotiate(peerId, state); } catch {}
            }
        };

        peers.current.set(peerId, state);
        return state;
    }, [rtcConfig, userId, conferenceId, send, localStream, attachLocalToPeer, renegotiate]);

    // JOIN & Kamera holen
    useEffect(() => {
        const canJoin = role !== "VIEWER" && !!userId && !!conferenceId;

        if (joinedConfRef.current && joinedConfRef.current !== conferenceId) {
            leaveNow();
        }

        if (canJoin && !joinedRef.current) {
            send({ type: "webrtc:join", userId, conferenceId, role });
            joinedRef.current = true;
            joinedConfRef.current = conferenceId;

            let mounted = true;
            (async () => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                    if (!mounted) return;
                    setLocalStream(stream);
                } catch {
                    setLocalStream(null); // recv-only
                }
            })();

            return () => { mounted = false; };
        }

        if (!canJoin && joinedRef.current) leaveNow();
    }, [role, userId, conferenceId, send, leaveNow]);

    // Wenn sich localStream ändert → replaceTrack auf alle Peers
    useEffect(() => {
        for (const [peerId, p] of peers.current.entries()) attachLocalToPeer(peerId, p, localStream);
    }, [localStream, attachLocalToPeer]);

    // Signaling
    useEffect(() => {
        if (role === "VIEWER") return;

        const onMessage = async (ev: MessageEvent) => {
            const msg = parseMsg(ev);
            if (!msg) return;

            switch (msg.type) {
                case "server:use-hls":
                    return;

                case "webrtc:peers": {
                    const m = msg as MsgPeers;
                    if (m.conferenceId !== conferenceId) return;
                    for (const pid of m.peers) getOrCreatePeer(pid);
                    return;
                }

                case "webrtc:peer-joined": {
                    const m = msg as MsgPeerJoined;
                    if (m.userId === userId) return;

                    // Falls von diesem user schon ein PeerConnection existiert → sauber schließen
                    const old = peers.current.get(m.userId);
                    if (old) {
                        try {
                            old.pc.ontrack = null as any;
                            old.pc.onicecandidate = null as any;
                            old.pc.close();
                        } catch {}
                        peers.current.delete(m.userId);
                        setRemoteStreams(prev => {
                            const c = { ...prev }; delete c[m.userId]; return c;
                        });
                    }

                    // Frische Verbindung aufbauen
                    getOrCreatePeer(m.userId);
                    return;
                }

                case "webrtc:peer-left": {
                    const m = msg as MsgPeerLeft;
                    const st = peers.current.get(m.userId);
                    if (st) st.pc.close();
                    peers.current.delete(m.userId);
                    setRemoteStreams(prev => {
                        const c = { ...prev }; delete c[m.userId]; return c;
                    });
                    return;
                }

                case "webrtc:offer": {
                    const m = msg as MsgOffer;
                    if (m.to !== userId) return;
                    const p = getOrCreatePeer(m.from);

                    const offer = new RTCSessionDescription(m.sdp);
                    const offerCollision = offer.type === "offer" && (p.makingOffer || p.pc.signalingState !== "stable");

                    if (offerCollision) {
                        if (!p.polite) { p.ignoreOffer = true; return; }
                        await p.pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit).catch(() => {});
                    }
                    p.ignoreOffer = false;

                    await p.pc.setRemoteDescription(offer);
                    for (const c of p.pendingCandidates.splice(0)) {
                        try { await p.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
                    }

                    await p.pc.setLocalDescription(await p.pc.createAnswer());
                    send({ type: "webrtc:answer", from: userId, to: m.from, conferenceId, sdp: p.pc.localDescription! });
                    return;
                }

                case "webrtc:answer": {
                    const m = msg as MsgAnswer;
                    if (m.to !== userId) return;
                    const p = getOrCreatePeer(m.from);
                    await p.pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
                    for (const c of p.pendingCandidates.splice(0)) {
                        try { await p.pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
                    }
                    return;
                }

                case "webrtc:candidate": {
                    const m = msg as MsgCand;
                    if (m.to !== userId || !m.candidate) return;
                    const p = getOrCreatePeer(m.from);
                    if (!p.pc.remoteDescription) { p.pendingCandidates.push(m.candidate); return; }
                    try { await p.pc.addIceCandidate(new RTCIceCandidate(m.candidate)); } catch {}
                    return;
                }

                default:
                    return;
            }
        };

        socket.addEventListener("message", onMessage);
        return () => socket.removeEventListener("message", onMessage);
    }, [role, socket, userId, conferenceId, getOrCreatePeer, send]);

    // Auf keinen Fall bei Tabwechsel hart leaven
    useEffect(() => {
        const onBeforeUnload = () => { try { leaveNow(); } catch {} };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => { window.removeEventListener("beforeunload", onBeforeUnload); };
    }, [leaveNow]);

    useEffect(() => { leaveNowRef.current = leaveNow; }, [leaveNow]);
    useEffect(() => () => { try { leaveNowRef.current(); } catch {} }, []);

    return { localStream, remoteStreams };
}
