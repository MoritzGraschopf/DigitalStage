// src/lib/useWebRTC.ts
import { useEffect, useMemo, useRef, useState } from 'react';

type Role = 'ORGANIZER' | 'PARTICIPANT' | 'VIEWER';

type SignalSocket = {
    send: (obj: unknown) => void;
    addEventListener: (ev: 'message', cb: (ev: MessageEvent) => void) => void;
    removeEventListener: (ev: 'message', cb: (ev: MessageEvent) => void) => void;
    readyState: number;
};

export function useWebRTC(params: {
    socket: SignalSocket;
    userId: string;
    conferenceId: string;
    role: Role;
}) {
    const { socket, userId, conferenceId, role } = params;

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] =
        useState<Record<string, MediaStream>>({});

    const peers = useRef<Map<string, RTCPeerConnection>>(new Map());

    const rtcConfig = useMemo<RTCConfiguration>(() => ({
        iceServers: [
            { urls: [process.env.NEXT_PUBLIC_STUN_URL || 'stun:stun.l.google.com:19302'] },
            // TURN-Beispiel (später aktivieren):
            // { urls: 'turn:your-turn.example.com:3478', username: 'user', credential: 'pass' }
        ]
    }), []);

    // helpers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const getOrCreatePc = (peerId: string) => {
        let pc = peers.current.get(peerId);
        if (pc) return pc;

        pc = new RTCPeerConnection(rtcConfig);

        pc.onnegotiationneeded = async () => {
            try{
                const offer = await pc!.createOffer();
                await pc!.setLocalDescription(offer);
                socket.send({
                    type: 'webrtc:offer',
                    from: userId,
                    to: peerId,
                    conferenceId,
                    sdp: offer
                })
            }
            catch{}
        }

        if (!localStream) {
            (pc as unknown).__xcv = {
                v: pc.addTransceiver('video', { direction: 'recvonly' }),
                a: pc.addTransceiver('audio', { direction: 'recvonly' }),
            };
        }

        // Local -> ICE an Signaling
        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                socket.send({
                    type: 'webrtc:candidate',
                    from: userId,
                    to: peerId,
                    conferenceId,
                    candidate: ev.candidate
                });
            }
        };

        // Remote -> Track empfangen
        pc.ontrack = (ev) => {
            const [stream] = ev.streams;
            setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
        };

        // Optional: Verbindung überwachen
        pc.onconnectionstatechange = () => {
            if (pc!.connectionState === 'failed' || pc!.connectionState === 'disconnected') {
                pc!.close();
                peers.current.delete(peerId);
                setRemoteStreams((prev) => {
                    const copy = { ...prev };
                    delete copy[peerId];
                    return copy;
                });
            }
        };

        // Lokale Tracks hinzufügen, wenn schon vorhanden
        if (localStream) {
            localStream.getTracks().forEach((t) => pc!.addTrack(t, localStream));
        }

        peers.current.set(peerId, pc);
        return pc;
    };

    useEffect(() => {
        if (role === 'VIEWER') return;

        socket.send({
            type: 'webrtc:join',
            userId,
            conferenceId,
            role,
        });
        try { console.log('[RTC] join sent', { userId, conferenceId, role }); } catch {}
        let isMounted = true;
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                if (!isMounted) return;
                setLocalStream(stream);
            } catch (err: unknown) {
                console.warn('[RTC] getUserMedia fehlgeschlagen (recv-only weiter):', err?.name || err);
                setLocalStream(null);
            }
        })();

        return () => { isMounted = false; };
    }, [role, socket, userId, conferenceId]);

    // Signaling Nachrichten
    useEffect(() => {
        if (role === 'VIEWER') return;

        const onMessage = async (ev: MessageEvent) => {
            let msg: unknown;
            try { msg = JSON.parse(ev.data); } catch { return; }

            // HLS Hinweis (falls Rolle falsch)
            if (msg.type === 'server:use-hls') return;

            if (msg.type === 'webrtc:peers') {
                for(const pid of msg.peers){
                    const pc = getOrCreatePc(pid);
                    if(localStream){
                        const senders = pc.getSenders();
                        localStream.getTracks().forEach((t) => {
                            if(!senders.find(s => s.track === t))
                                pc.addTrack(t, localStream);
                        })
                    }
                }
            }

            if (msg.type === 'webrtc:peer-joined') {
                const pid = msg.userId;
                if (pid === userId) return;
                const pc = getOrCreatePc(pid);
                if (localStream) {
                    const senders = pc.getSenders();
                    localStream.getTracks().forEach((t) => {
                        if (!senders.find(s => s.track === t))
                            pc.addTrack(t, localStream);
                    });
                }
            }

            if (msg.type === 'webrtc:offer' && msg.to === userId) {
                const pc = getOrCreatePc(msg.from);
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                if (localStream) {
                    const senders = pc.getSenders();
                    localStream.getTracks().forEach((t) => {
                        if (!senders.find(s => s.track === t)) pc.addTrack(t, localStream);
                    });
                }
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.send({
                    type: 'webrtc:answer',
                    from: userId,
                    to: msg.from,
                    conferenceId,
                    sdp: answer
                });
            }

            if (msg.type === 'webrtc:answer' && msg.to === userId) {
                const pc = getOrCreatePc(msg.from);
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            }

            if (msg.type === 'webrtc:candidate' && msg.to === userId) {
                const pc = getOrCreatePc(msg.from);
                if (msg.candidate) {
                    try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
                }
            }

            if (msg.type === 'webrtc:peer-left') {
                const pid = msg.userId;
                const pc = peers.current.get(pid);
                if (pc) {
                    pc.close();
                    peers.current.delete(pid);
                }
                setRemoteStreams((prev) => {
                    const copy = { ...prev };
                    delete copy[pid];
                    return copy;
                });
            }
        };

        socket.addEventListener('message', onMessage);
        return () => socket.removeEventListener('message', onMessage);
    }, [role, socket, userId, conferenceId, localStream, getOrCreatePc]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (role === 'VIEWER') return;
            socket.send({ type: 'webrtc:leave', userId, conferenceId });
            // eslint-disable-next-line react-hooks/exhaustive-deps
            for (const pc of peers.current.values()) pc.close();
            peers.current.clear();
            localStream?.getTracks().forEach((t) => t.stop());
        };
    }, [role, socket, userId, conferenceId, localStream]);

    return { localStream, remoteStreams };
}
