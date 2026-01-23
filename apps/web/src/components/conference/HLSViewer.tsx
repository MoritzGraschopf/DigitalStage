"use client";

import { useEffect, useRef, useState } from "react";
import { User } from "@prisma/client";
import { useWS } from "@/context/WebSocketContext";
import { Badge } from "@/components/ui/badge";
import { Crown } from "lucide-react";
import type HlsType from "hls.js";

interface HLSViewerProps {
    conferenceId: string;
    currentPresenter: User | null;
    organizerId: string | null;
    hasQuestioner: boolean;
}

export function HLSViewer({ 
    conferenceId, 
    currentPresenter,
    organizerId,
    hasQuestioner
}: HLSViewerProps) {
    const [hasHls, setHasHls] = useState(false);
    const screenVideoRef = useRef<HTMLVideoElement>(null);
    const presenterVideoRef = useRef<HTMLVideoElement>(null);
    const questionerVideoRef = useRef<HTMLVideoElement>(null);
    const organizerVideoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const ws = useWS();
    
    const [activeStreams, setActiveStreams] = useState<{
        screen: boolean;
        presenter: boolean;
        questioner: boolean;
        organizer: boolean;
    }>({
        screen: false,
        presenter: false,
        questioner: false,
        organizer: false,
    });

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const screenUrl = `${baseUrl}/hls/screen.m3u8`;
    const presenterUrl = `${baseUrl}/hls/presenter.m3u8`;
    const questionerUrl = `${baseUrl}/hls/questioner.m3u8`;
    const organizerUrl = `${baseUrl}/hls/organizer.m3u8`;
    
    const isOrganizerPresenter = currentPresenter?.id === organizerId;
    const showPresenterVideo = !isOrganizerPresenter && !!currentPresenter;
    const showQuestionerVideo = hasQuestioner;
    const showOrganizerVideo = !isOrganizerPresenter && !!organizerId;

    useEffect(() => {
        const off = ws.on("server:use-hls", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId === conferenceId) {
                console.log("✅ HLS verfügbar für Konferenz", conferenceId);
                setHasHls(true);
            }
        });
        return off;
    }, [ws, conferenceId]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setHasHls(true);
        }, 1000);
        return () => clearTimeout(timer);
    }, [conferenceId]);

    useEffect(() => {
        if (!hasHls) return;

        const hlsInstancesRef = new Map<string, HlsType>();

        const loadHls = async () => {
            let HlsClass: typeof HlsType | null = null;
            if (typeof window !== 'undefined') {
                try {
                    const hlsModule = await import('hls.js');
                    HlsClass = hlsModule.default;
                } catch {
                    console.log("HLS.js nicht verfügbar, verwende native HLS-Unterstützung");
                }
            }

            const loadStream = (
                element: HTMLVideoElement | HTMLAudioElement, 
                url: string,
                streamKey: 'screen' | 'presenter' | 'questioner' | 'organizer' | null = null
            ) => {
                if (!element) return;

                const oldHls = hlsInstancesRef.get(streamKey || 'unknown');
                if (oldHls) {
                    oldHls.destroy();
                    hlsInstancesRef.delete(streamKey || 'unknown');
                }
                if (element instanceof HTMLVideoElement) {
                    element.pause();
                    element.src = '';
                    element.load();
                }

                const markActive = () => {
                    if (streamKey) {
                        setActiveStreams(prev => ({ ...prev, [streamKey]: true }));
                    }
                };

                if (HlsClass && HlsClass.isSupported()) {
                    const hls = new HlsClass({ 
                        enableWorker: false,
                        lowLatencyMode: true,
                    });
                    if (streamKey) {
                        hlsInstancesRef.set(streamKey, hls);
                    }
                    hls.loadSource(url);
                    hls.attachMedia(element);
                    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
                        element.play().catch((err) => console.warn("Autoplay blocked:", err));
                        if (streamKey && element instanceof HTMLVideoElement) {
                            element.addEventListener("playing", markActive, { once: true });
                            element.addEventListener("timeupdate", markActive, { once: true });
                            element.addEventListener('ended', () => {
                                if (streamKey) {
                                    setActiveStreams(prev => ({ ...prev, [streamKey]: false }));
                                }
                            });
                        }
                    });
                    hls.on(HlsClass.Events.ERROR, (_event, data) => {
                        if (data.fatal) {
                            console.error("HLS fatal error:", data);
                            if (streamKey) {
                                setActiveStreams(prev => ({ ...prev, [streamKey]: false }));
                            }
                        }
                    });
                } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
                    element.src = url;
                    element.play().catch((err) => console.warn("Autoplay blocked:", err));
                    if (streamKey && element instanceof HTMLVideoElement) {
                        element.addEventListener("playing", markActive, { once: true });
                        element.addEventListener("timeupdate", markActive, { once: true });
                        element.addEventListener('ended', () => {
                            if (streamKey) {
                                setActiveStreams(prev => ({ ...prev, [streamKey]: false }));
                            }
                        });
                    }
                } else {
                    console.warn("HLS wird nicht unterstützt in diesem Browser");
                }
            };

            if (screenVideoRef.current) {
                loadStream(screenVideoRef.current, screenUrl, 'screen');
            }
            
            if (showPresenterVideo && presenterVideoRef.current) {
                loadStream(presenterVideoRef.current, presenterUrl, 'presenter');
            }
            if (showQuestionerVideo && questionerVideoRef.current) {
                loadStream(questionerVideoRef.current, questionerUrl, 'questioner');
            }
            if (showOrganizerVideo && organizerVideoRef.current) {
                loadStream(organizerVideoRef.current, organizerUrl, 'organizer');
            }
            
            if (audioRef.current) {
                loadStream(audioRef.current, screenUrl);
            }
        };

        loadHls();

        return () => {
            hlsInstancesRef.forEach(h => {
                try { h.destroy(); } catch {}
            });
            hlsInstancesRef.clear();
        };
    }, [hasHls, screenUrl, presenterUrl, questionerUrl, organizerUrl, showPresenterVideo, showQuestionerVideo, showOrganizerVideo]);

    if (!hasHls) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                <div className="text-center mb-6">
                    <div className="text-6xl mb-4">👁️</div>
                    <div className="text-xl font-medium mb-2">Du bist <b>Zuschauer</b></div>
                    <div className="text-sm">Warte auf Stream...</div>
                </div>
                {currentPresenter && (
                    <div className="text-center">
                        <div className="text-sm text-muted-foreground mb-1">Aktueller Präsentator:</div>
                        <Badge variant="default" className="flex items-center gap-1 w-fit mx-auto">
                            <Crown className="w-3 h-3" />
                            {currentPresenter.firstName} {currentPresenter.lastName ?? ""}
                        </Badge>
                    </div>
                )}
            </div>
        );
    }

    type OverlayStream = {
        key: "presenter" | "questioner" | "organizer";
        ref: React.RefObject<HTMLVideoElement | null>;
        label: string;
        isActive: boolean;
    };

    const overlayStreams: OverlayStream[] = (
        [
            showPresenterVideo
                ? { key: "presenter", ref: presenterVideoRef, label: "Präsentator", isActive: activeStreams.presenter }
                : null,
            showQuestionerVideo
                ? { key: "questioner", ref: questionerVideoRef, label: "Fragesteller", isActive: activeStreams.questioner }
                : null,
            showOrganizerVideo
                ? { key: "organizer", ref: organizerVideoRef, label: "Organisator", isActive: activeStreams.organizer }
                : null,
        ].filter(Boolean) as OverlayStream[]
    );

    return (
        <div className="h-full flex flex-col p-2 sm:p-3 md:p-4 gap-3 sm:gap-4">
            {currentPresenter && (
                <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 bg-muted/30 rounded-lg mb-2">
                    <Crown className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm font-medium">
                        Präsentator: {currentPresenter.firstName} {currentPresenter.lastName ?? ""}
                    </span>
                </div>
            )}

            <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden bg-black">
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                />

                {!activeStreams.screen && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-muted-foreground">Keine Bildschirm-Freigabe</span>
                    </div>
                )}

                {activeStreams.screen && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 py-3">
                        <span className="text-sm font-semibold text-white">Bildschirm-Freigabe</span>
                    </div>
                )}

                {overlayStreams.length > 0 && (
                    <div className="absolute bottom-4 right-4 flex flex-col gap-2 items-end">
                        {overlayStreams.map((s, index) => (
                            <div
                                key={s.key}
                                className="relative w-48 sm:w-56 md:w-64 h-32 sm:h-40 rounded-xl overflow-hidden bg-gradient-to-br from-background to-muted/30 border-2 border-background shadow-2xl"
                                style={{ animation: `slideInRight 0.3s ease-out ${index * 0.1}s both` }}
                            >
                                <video
                                    ref={s.ref}
                                    autoPlay
                                    playsInline
                                    className="w-full h-full object-cover"
                                />

                                {!s.isActive && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-xs">
                                        Warte auf Stream…
                                    </div>
                                )}

                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2 py-2">
                                    <span className="text-xs font-semibold text-white">{s.label}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <audio ref={audioRef} autoPlay playsInline />
            
            <style jsx>{`
                @keyframes slideInRight {
                    from {
                        opacity: 0;
                        transform: translateX(100%);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
            `}</style>
        </div>
    );
}
