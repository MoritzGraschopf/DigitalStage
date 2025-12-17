"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Conference, User, UserConference } from "@prisma/client";
import { useWebSocket, useWS } from "@/context/WebSocketContext";
import { useWebRTC } from "@/lib/webRTC";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Copy, Info, LoaderCircle, MessageCircle, X, Monitor, MonitorOff, Crown, Mic, MicOff } from "lucide-react";
import ConferenceChat from "@/components/ConferenceChat";

type ConferenceWithParticipants = Conference & { 
    participants: Array<UserConference & { isPresenter?: boolean }> 
};

// Erweitere Role-Type für TypeScript (bis Prisma generate ausgeführt wurde)
type ExtendedRole = "ORGANIZER" | "PARTICIPANT" | "VIEWER" | "QUESTIONER";

const mapStatus = (status: string): string =>
    ({ SCHEDULED: "Geplant", ACTIVE: "Aktiv", ENDED: "Beendet" } as const)[status] ?? "Unbekannt";

type VideoTileProps = {
    stream: MediaStream | null;
    title: string;
    mutedByDefault?: boolean;
    className?: string;
    mirror?: boolean;
    isLocal?: boolean;
};

function VideoTile({
                              stream,
                              title,
                              mutedByDefault = false,
                              className = "",
                              mirror = false,
                              isLocal = false,
                          }: VideoTileProps) {
    const ref = useRef<HTMLVideoElement | null>(null);
    const [muted, setMuted] = useState<boolean>(mutedByDefault);
    const [needsUserAction, setNeedsUserAction] = useState(false);
    const isPlayingRef = useRef(false);
    const currentStreamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        setMuted(mutedByDefault);
    }, [mutedByDefault]);

    const tryPlay = useCallback(() => {
        const el = ref.current;
        if (!el || !stream) return;
        const playPromise = el.play();
        if (playPromise) {
            playPromise
                .then(() => {
                    setTimeout(() => {
                        if (el.paused || el.readyState === 0) {
                            console.warn("Video paused or not ready after play()", title);
                            setNeedsUserAction(true);
                        } else {
                            setNeedsUserAction(false);
                        }
                    }, 500);
                })
                .catch((err: DOMException) => {
                    console.warn("autoplay blocked", title, err.name, err.message);
                    setNeedsUserAction(true);
                });
        } else {
            setTimeout(() => {
                if (el.paused || el.readyState === 0) {
                    setNeedsUserAction(true);
                }
            }, 500);
        }
    }, [title, stream]);

    const handleUserPlay = useCallback(() => {
        const el = ref.current;
        if (!el || isPlayingRef.current)
            return;

        if(isLocal){
            el.muted = true;
            setNeedsUserAction(false);
            isPlayingRef.current = true;
            return;
        }
        
        isPlayingRef.current = true;
        setMuted(false);
        el.muted = false;
        
        const attemptPlay = () => {
            const playPromise = el.play();
            if (playPromise) {
                playPromise
                    .then(() => {
                        console.log("✅ Video started after user interaction", title);
                        setNeedsUserAction(false);
                        isPlayingRef.current = false;
                    })
                    .catch((err: DOMException) => {
                        if (err.name === "AbortError") {
                            console.warn("⚠️ Play interrupted, retrying...", title);
                            setTimeout(() => {
                                if (ref.current && !ref.current.paused) {
                                    setNeedsUserAction(false);
                                    isPlayingRef.current = false;
                                } else if (ref.current) {
                                    attemptPlay();
                                } else {
                                    isPlayingRef.current = false;
                                }
                            }, 100);
                        } else {
                            console.error("❌ Play failed even after user interaction", title, err);
                            setNeedsUserAction(true);
                            isPlayingRef.current = false;
                        }
                    });
            } else {
                isPlayingRef.current = false;
            }
        };
        
        attemptPlay();
    }, [title, isLocal]);

    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;

        if (currentStreamRef.current !== stream) {
            currentStreamRef.current = stream;
            el.srcObject = stream;
        }
        
        el.muted = muted; // autoplay-policy safe

        if (!isPlayingRef.current) {
            tryPlay();
        }

        if (!stream) return;

        const onMeta = (): void => {
            console.log(
                "🎬 loadedmetadata",
                title,
                "tracks:",
                stream.getTracks().map(t => t.kind)
            );

            tryPlay();
        };

        const onAddTrack = (ev: MediaStreamTrackEvent): void => {
            console.log("➕ track added", title, ev.track.kind);
            onMeta();
        };

        const onPlaying = (): void => {
            console.log("▶️ playing", title);
            setNeedsUserAction(false);
        };

        const onPause = (): void => {
            console.log("⏸️ paused", title);
            if (el.readyState > 0 && stream.getTracks().length > 0) {
                setNeedsUserAction(true);
            }
        };

        // Handler setzen
        stream.onaddtrack = onAddTrack;
        el.addEventListener("loadedmetadata", onMeta);
        el.addEventListener("playing", onPlaying);
        el.addEventListener("pause", onPause);

        if (el.readyState >= 1) onMeta();

        const checkTimeout = setTimeout(() => {
            if (el.paused && el.readyState > 0 && stream.getTracks().length > 0) {
                console.warn("Video still paused after setup", title);
                setNeedsUserAction(true);
            }
        }, 1000);

        return () => {
            clearTimeout(checkTimeout);
            stream.onaddtrack = null;
            el.removeEventListener("loadedmetadata", onMeta);
            el.removeEventListener("playing", onPlaying);
            el.removeEventListener("pause", onPause);
        };
    }, [stream, mutedByDefault, title, muted, tryPlay]);

    const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState !== "ended");
    const hasAudio = !!stream?.getAudioTracks().some((t) => t.readyState !== "ended");

    return (
        <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-background to-muted/30 border shadow-lg hover:shadow-xl transition-all duration-300 group">
            <div className="relative aspect-video bg-gradient-to-br from-muted/20 to-muted/10">
                <video
                    ref={ref}
                    autoPlay
                    playsInline
                    muted={isLocal ? true: muted}
                    className={`${className} w-full h-full object-cover ${mirror ? "scale-x-[-1]" : ""}`}
                />
                {!hasVideo && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/40 to-muted/20 backdrop-blur-sm">
                        <div className="text-center">
                            <div className="text-3xl mb-2 opacity-50">📹</div>
                            <div className="text-sm text-muted-foreground">Kein Video</div>
                        </div>
                    </div>
                )}
                {needsUserAction && (
                    <button
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm text-white text-base font-medium flex items-center justify-center z-10 hover:bg-black/80 active:bg-black/90 transition-all cursor-pointer"
                        onClick={handleUserPlay}
                        type="button"
                    >
                        <div className="text-center">
                            <div className="text-4xl mb-3">▶️</div>
                            <div className="text-sm">Tippe zum Abspielen</div>
                        </div>
                    </button>
                )}
                
                {/* Audio Status Indicator */}
                {hasAudio && !muted && (
                    <div className="absolute top-3 right-3 bg-green-500/90 text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 backdrop-blur-sm shadow-lg">
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                        <span className="font-medium">Audio</span>
                    </div>
                )}

                {/* Name and Controls Overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs sm:text-sm font-semibold text-white truncate flex-1 min-w-0">{title}</span>
                        {hasAudio && (
                            <button
                                className="ml-2 sm:ml-3 p-1.5 sm:p-2 rounded-lg bg-black/40 hover:bg-black/60 text-white transition-all flex-shrink-0 backdrop-blur-sm hover:scale-110 active:scale-95"
                                onClick={() => setMuted(m => !m)}
                                title={muted ? "Ton an" : "Ton aus"}
                            >
                                {muted ? (
                                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                    </svg>
                                ) : (
                                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                    </svg>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// HLS Viewer Component für Viewer-Rolle
function HLSViewer({ 
    conferenceId, 
    currentPresenter 
}: { 
    conferenceId: string; 
    currentPresenter: User | null;
}) {
    const [hasHls, setHasHls] = useState(false);
    const camVideoRef = useRef<HTMLVideoElement>(null);
    const screenVideoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const ws = useWS();

    // HLS-URLs konstruieren
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const camUrl = `${baseUrl}/hls/${conferenceId}/cam/index.m3u8`;
    const screenUrl = `${baseUrl}/hls/${conferenceId}/screen/index.m3u8`;
    const audioUrl = `${baseUrl}/hls/${conferenceId}/audio/index.m3u8`;

    // WebSocket Event: server:use-hls (optional, für sofortige Benachrichtigung)
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

    // Automatisch HLS aktivieren wenn Viewer (nicht auf Event warten)
    useEffect(() => {
        // Kurze Verzögerung, damit die Konferenz geladen ist
        const timer = setTimeout(() => {
            setHasHls(true);
        }, 1000);
        return () => clearTimeout(timer);
    }, [conferenceId]);

    // HLS-Streams laden wenn verfügbar
    useEffect(() => {
        if (!hasHls) return;

        const loadHls = async () => {
            // Prüfe ob HLS.js verfügbar ist (für Browser ohne native HLS-Unterstützung)
            let Hls: any = null;
            if (typeof window !== 'undefined') {
                try {
                    // Versuche HLS.js dynamisch zu laden (optional)
                    const hlsModule = await import('hls.js');
                    Hls = hlsModule.default;
                } catch (e) {
                    console.log("HLS.js nicht verfügbar, verwende native HLS-Unterstützung");
                }
            }

            // Helper-Funktion zum Laden eines HLS-Streams
            const loadStream = (element: HTMLVideoElement | HTMLAudioElement, url: string) => {
                if (!element) return;

                if (Hls && Hls.isSupported()) {
                    // HLS.js für Chrome/Firefox/etc.
                    const hls = new Hls({ 
                        enableWorker: false,
                        lowLatencyMode: true,
                    });
                    hls.loadSource(url);
                    hls.attachMedia(element);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        element.play().catch((e) => console.warn("Autoplay blocked:", e));
                    });
                    hls.on(Hls.Events.ERROR, (event: any, data: any) => {
                        if (data.fatal) {
                            console.error("HLS fatal error:", data);
                        }
                    });
                } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
                    // Native HLS-Unterstützung (Safari, iOS)
                    element.src = url;
                    element.play().catch((e) => console.warn("Autoplay blocked:", e));
                } else {
                    console.warn("HLS wird nicht unterstützt in diesem Browser");
                }
            };

            // Streams laden
            if (camVideoRef.current) {
                loadStream(camVideoRef.current, camUrl);
            }
            if (screenVideoRef.current) {
                loadStream(screenVideoRef.current, screenUrl);
            }
            if (audioRef.current) {
                loadStream(audioRef.current, audioUrl);
            }
        };

        loadHls();
    }, [hasHls, camUrl, screenUrl, audioUrl]);

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

    return (
        <div className="h-full flex flex-col p-2 sm:p-3 md:p-4 gap-3 sm:gap-4">
            {/* Präsentator-Info */}
            {currentPresenter && (
                <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 bg-muted/30 rounded-lg mb-2">
                    <Crown className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm font-medium">
                        Präsentator: {currentPresenter.firstName} {currentPresenter.lastName ?? ""}
                    </span>
                </div>
            )}

            {/* Screen-Share groß (wenn verfügbar) */}
            <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden bg-black">
                <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted={false}
                    className="w-full h-full object-contain"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 py-3">
                    <span className="text-sm font-semibold text-white">Bildschirm-Freigabe</span>
                </div>

                {/* Kamera-Stream als Overlay unten rechts */}
                <div className="absolute bottom-4 right-4 w-48 sm:w-56 md:w-64 h-32 sm:h-40 rounded-xl overflow-hidden bg-gradient-to-br from-background to-muted/30 border-2 border-background shadow-2xl">
                    <video
                        ref={camVideoRef}
                        autoPlay
                        playsInline
                        muted={false}
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2 py-2">
                        <span className="text-xs font-semibold text-white">Kamera</span>
                    </div>
                </div>
            </div>

            {/* Audio-Stream (unsichtbar) */}
            <audio ref={audioRef} autoPlay playsInline />
        </div>
    );
}

export default function Page({ params }: { params: Promise<{ link: string }> }) {
    const { link } = use(params);

    const [disabled, setDisabled] = useState(false);
    const [conference, setConference] = useState<ConferenceWithParticipants | null>(null);
    const [organizer, setOrganizer] = useState<User | null>(null);
    const [showText, setShowText] = useState(false);
    const [copied, setCopied] = useState(false);

    const [commandOpen, setCommandOpen] = useState(false);
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    const { fetchWithAuth, user } = useAuth();
    const { socket, send } = useWebSocket();
    const lastInitRef = useRef<string | null>(null);
    const ws = useWS();


    useEffect(() => {
        const t = setTimeout(() => setShowText(true), 5000);
        return () => clearTimeout(t);
    }, []);

    const fetchConference = useCallback(async () => {
        try {
            const res = await fetchWithAuth<ConferenceWithParticipants>(`/api/conference/${link}`);
            if (res.status === "ENDED") setDisabled(true);
            setConference(res);
        } catch (err) {
            console.error(err);
        }
    }, [fetchWithAuth, link]);

    useEffect(() => {
        fetchConference();
        const off1 = ws.on("server:ConferenceParticipantsAdded", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off2 = ws.on("server:ConferenceParticipantsRemoved", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off3 = ws.on("server:PresenterChanged", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off4 = ws.on("server:QuestionerActivated", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off5 = ws.on("server:QuestionerDeactivated", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        return () => {
            off1();
            off2();
            off3();
            off4();
            off5();
        };
    }, [ws, conference?.id, fetchConference]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const r = await fetch("/api/user");
                const data: User[] = await r.json();
                if (cancelled) return;
                setAllUsers(data);
            } catch (e) {
                console.error("Error fetching users:", e);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!conference) {
            setOrganizer(null);
            return;
        }
        setOrganizer(allUsers.find(u => u.id === conference.organizerId) ?? null);
    }, [conference?.organizerId, allUsers, conference]);


    const derivedRole: ExtendedRole = useMemo(() => {
        if (!conference || !user?.id) return "VIEWER";
        if (conference.organizerId === user.id) return "ORGANIZER";
        const uc = conference.participants.find(p => p.userId === user.id);
        if (!uc) return "VIEWER";
        return uc.role as ExtendedRole;
    }, [conference, user?.id]);

    // Aktueller Präsentator
    const currentPresenter = useMemo(() => {
        if (!conference) return null;
        const presenter = conference.participants.find(p => p.isPresenter);
        if (!presenter) return null;
        return allUsers.find(u => u.id === presenter.userId) ?? null;
    }, [conference, allUsers]);

    // Ist der aktuelle User der Präsentator?
    const isCurrentUserPresenter = useMemo(() => {
        if (!conference || !user?.id) return false;
        const uc = conference.participants.find(p => p.userId === user.id);
        return uc?.isPresenter ?? false;
    }, [conference, user?.id]);

    useEffect(() => {
        if (!user?.id || !conference?.id) return;

        // QUESTIONER und PARTICIPANT/ORGANIZER haben WebRTC-Verbindung, VIEWER nicht
        const inConference = derivedRole !== "VIEWER";

        const payloadKey = JSON.stringify({
            userId: user.id,
            conferenceId: conference.id,
            inConference,
        });

        if(lastInitRef.current === payloadKey)
            return;

        ws.send({ type: "init", userId: user.id, inConference, conferenceId: conference.id });
        lastInitRef.current = payloadKey;
    }, [ws, user?.id, conference?.id, derivedRole]);

    // Organizer-UI
    const visibleUsers = useMemo(
        () => allUsers.filter(u => (user ? u.id !== user.id : true)),
        [allUsers, user]
    );

    const currentParticipants = useMemo(() => {
        if (!conference) return [] as User[];
        // Teilnehmer: PARTICIPANT oder QUESTIONER (aber nicht Organizer)
        const parts = conference.participants.filter(p => {
            const role = p.role as ExtendedRole;
            return (role === "PARTICIPANT" || role === "QUESTIONER") && p.userId !== conference.organizerId;
        });
        const mapById = new Map(allUsers.map(u => [u.id, u]));
        return parts
            .map(p => mapById.get(p.userId))
            .filter((u): u is User => !!u);
    }, [conference, allUsers]);

    // Zuschauer (VIEWER)
    const currentViewers = useMemo(() => {
        if (!conference) return [] as User[];
        const viewers = conference.participants.filter(p => p.role === "VIEWER");
        const mapById = new Map(allUsers.map(u => [u.id, u]));
        return viewers
            .map(p => mapById.get(p.userId))
            .filter((u): u is User => !!u);
    }, [conference, allUsers]);

    const maxTotal = 10;
    const currentCount = currentParticipants.length;
    const remainingSlots = Math.max(0, maxTotal - currentCount);
    const atLimit = selectedUserIds.length >= remainingSlots && remainingSlots > 0;

    const toggleUser = (id: string) => {
        if (user && id === user.id) return;
        setSelectedUserIds(prev => {
            const isSelected = prev.includes(id);
            if (isSelected) return prev.filter(x => x !== id);
            if (remainingSlots <= 0) return prev;
            if (prev.length >= remainingSlots) return prev;
            const already = currentParticipants.some(p => p.id === id);
            if (already)
                return prev;
            return [...prev, id];
        });
    };

    const handleInviteSubmit = async () => {
        try {
            if (!conference)
                return;
            if (selectedUserIds.length === 0)
            {
                setCommandOpen(false);
                return;
            }

            await fetchWithAuth(`/api/conference/${conference.link}/participants`, {
                method: "POST",
                body: JSON.stringify({ userIds: selectedUserIds }),
            });
            ws.send({ type: "ConferenceParticipantsAdded", conferenceId: conference.id, userIds: selectedUserIds, link: conference.link });
            setSelectedUserIds([]);
            setCommandOpen(false);
            fetchConference();
        } catch (e) {
            console.error("Teilnehmer hinzufügen fehlgeschlagen:", e);
        }
    };

    const handleRemoveParticipant = async (userId: string) => {
        try {
            if (!conference) return;
            await fetchWithAuth(`/api/conference/${conference.link}/participants/${userId}`, {
                method: "DELETE",
            });
            ws.send({ type: "ConferenceParticipantsRemoved", conferenceId: conference.id, userIds: [userId], link: conference.link });
            fetchConference(); // Sofort aktualisieren
        } catch (e) {
            console.error("Teilnehmer entfernen fehlgeschlagen:", e);
        }
    };

    const handleSetPresenter = async (userId: string | null) => {
        try {
            if (!conference) return;
            if (userId) {
                await fetchWithAuth(`/api/conference/${conference.link}/presenter`, {
                    method: "POST",
                    body: JSON.stringify({ userId }),
                });
                ws.send({ 
                    type: "PresenterChanged", 
                    conferenceId: conference.id, 
                    presenterUserId: userId, 
                    link: conference.link 
                });
            } else {
                await fetchWithAuth(`/api/conference/${conference.link}/presenter`, {
                    method: "DELETE",
                });
                ws.send({ 
                    type: "PresenterChanged", 
                    conferenceId: conference.id, 
                    presenterUserId: null, 
                    link: conference.link 
                });
            }
            fetchConference();
        } catch (e) {
            console.error("Präsentator setzen fehlgeschlagen:", e);
        }
    };

    const handleActivateQuestioner = async (userId: string) => {
        try {
            if (!conference) return;
            await fetchWithAuth(`/api/conference/${conference.link}/questioner/${userId}`, {
                method: "POST",
            });
            ws.send({ 
                type: "QuestionerActivated", 
                conferenceId: conference.id, 
                userId, 
                link: conference.link 
            });
            fetchConference();
        } catch (e) {
            console.error("Fragesteller aktivieren fehlgeschlagen:", e);
        }
    };

    const handleDeactivateQuestioner = async (userId: string) => {
        try {
            if (!conference) return;
            await fetchWithAuth(`/api/conference/${conference.link}/questioner/${userId}`, {
                method: "DELETE",
            });
            ws.send({ 
                type: "QuestionerDeactivated", 
                conferenceId: conference.id, 
                userId, 
                link: conference.link 
            });
            fetchConference();
        } catch (e) {
            console.error("Fragesteller deaktivieren fehlgeschlagen:", e);
        }
    };

    const rtcReady = !!user?.id && !!conference?.id;

    // --- WebRTC mit DB-basierter Rolle ---
    const { localStream, remoteStreams, startScreenShare, stopScreenShare, isScreenSharing, localScreenStream } = useWebRTC({
        socket,
        send,
        userId: rtcReady ? user.id : "",
        conferenceId: conference?.id ?? "",
        role: derivedRole,
    });

    // Map peerId (userId) zu User-Namen
    const getUserName = useCallback((peerId: string): string => {
        const foundUser = allUsers.find(u => u.id === peerId);
        if (foundUser) {
            return `${foundUser.firstName}${foundUser.lastName ? ` ${foundUser.lastName}` : ""}`;
        }
        return peerId;
    }, [allUsers]);

    // Hilfsfunktion: Trenne Screenshare-Streams von normalen Video-Streams
    // Ein Stream mit mehreren Video-Tracks hat wahrscheinlich Screenshare
    const { participantStreams, screenShareStreams } = useMemo(() => {
        const participants: Record<string, MediaStream> = {};
        const screens: Record<string, MediaStream> = {};

        Object.entries(remoteStreams).forEach(([userId, stream]) => {
            const videoTracks = stream.getVideoTracks();
            
            // Wenn mehr als 1 Video-Track, ist der zweite wahrscheinlich Screenshare
            if (videoTracks.length > 1) {
                // Erster Track = Kamera
                const cameraStream = new MediaStream([videoTracks[0], ...stream.getAudioTracks()]);
                participants[userId] = cameraStream;
                
                // Zweiter Track = Screenshare
                const screenStream = new MediaStream([videoTracks[1]]);
                screens[userId] = screenStream;
            } else if (videoTracks.length === 1) {
                // Prüfe Track-Label für Screenshare-Indikatoren
                const track = videoTracks[0];
                const label = track.label.toLowerCase();
                if (label.includes('screen') || label.includes('display') || label.includes('window')) {
                    screens[userId] = stream;
                } else {
                    participants[userId] = stream;
                }
            } else {
                // Nur Audio oder kein Video
                participants[userId] = stream;
            }
        });

        return { participantStreams: participants, screenShareStreams: screens };
    }, [remoteStreams]);

    // Aktiver Screenshare (erster gefundener)
    const activeScreenShare = useMemo(() => {
        const entries = Object.entries(screenShareStreams);
        if (entries.length > 0) {
            const [userId, stream] = entries[0];
            return { userId, stream, userName: getUserName(userId) };
        }
        return null;
    }, [screenShareStreams, getUserName]);

    if (!conference) {
        return (
            <div className="h-screen w-screen fixed top-0 left-0 z-[-1] flex justify-center items-center flex-col gap-2">
                <LoaderCircle className="animate-spin" />
                {showText && <p className="text-muted-foreground">Die Konferenz ist möglicherweise nicht mehr verfügbar.</p>}
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:grid lg:grid-cols-[3fr_1fr] lg:grid-rows-[min-content_1fr] h-screen w-screen fixed top-0 left-0 z-[-1] overflow-hidden">
            <div className="h-13"></div>
            <div></div>

            {/* Toolbar für mobile Geräte */}
            <div className="lg:hidden flex items-center justify-between gap-2 p-2 border-b bg-background/95 backdrop-blur-sm z-40">
                <div className="flex items-center gap-2">
                    <Button asChild variant="ghost" size="sm">
                        <Link href="/app" className="flex items-center gap-1.5">
                            <ArrowLeft className="w-4 h-4" />
                            <span>Verlassen</span>
                        </Link>
                    </Button>
                    {derivedRole === "ORGANIZER" && (
                        <Button 
                            disabled={conference.status === "ENDED"} 
                            onClick={() => setCommandOpen(true)}
                            size="sm"
                            variant="outline"
                        >
                            Teilnehmer hinzufügen
                        </Button>
                    )}
                </div>
                <Sheet>
                    <SheetTrigger asChild>
                        <Button size="icon" variant="ghost">
                            <Info className="w-4 h-4" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent>
                        <SheetHeader>
                            <SheetTitle>Konferenzinfo</SheetTitle>
                            <SheetDescription>Live-Stream mit Chat für alle Zuschauer dieser Konferenz.</SheetDescription>
                        </SheetHeader>
                        <div className="grid grid-cols-[min-content_1fr] items-center gap-2 px-4 mt-4">
                            <div className="font-medium">Titel:</div>
                            <div className="text-right">{conference.title}</div>
                            <Separator className="col-span-2" />
                            <div className="font-medium">Beschreibung:</div>
                            <div className="text-right">{conference.description}</div>
                            <Separator className="col-span-2" />
                            <div className="font-medium">Von:</div>
                            <div className="text-right">{!!conference.startAt ? new Date(conference.startAt).toLocaleDateString("de-DE") : "Datum nicht verfügbar"}</div>
                            <div className="font-medium">Bis:</div>
                            <div className="text-right">{!!conference.endDate ? new Date(conference.endDate).toLocaleDateString("de-DE") : "Datum nicht verfügbar"}</div>
                            <Separator className="col-span-2" />
                            <div className="font-medium">Status:</div>
                            <div className="text-right">{mapStatus(conference.status)}</div>
                            <Separator className="col-span-2" />
                            <div className="font-medium">Organisator:</div>
                            <div className="text-right">
                                <div className="flex flex-wrap justify-end gap-1">
                                    <Badge variant="outline">{organizer?.firstName} {organizer?.lastName ?? ""}</Badge>
                                </div>
                            </div>
                            <Separator className="col-span-2" />
                            <div className="font-medium">Teilnehmer:</div>
                            <div className="text-right">
                                <div className="flex flex-wrap justify-end gap-1">
                                    {currentParticipants.map((u) => <Badge key={u.id} variant="outline">{u.firstName} {u.lastName ?? ""}</Badge>)}
                                </div>
                            </div>
                            <Separator className="col-span-2" />
                            <div className="font-medium">Link:</div>
                            <div className="text-right">
                                <Tooltip>
                                    <TooltipTrigger asChild><Button onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(`${window.location.origin}/app/${link}`);
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 2000);
                                        } catch (err) { console.error("Kopieren fehlgeschlagen:", err); }
                                    }} size="icon" variant="outline">
                                        {copied ? <Check /> : <Copy />}
                                    </Button></TooltipTrigger>
                                    <TooltipContent side="left"><p>{copied ? "Kopiert!" : "Link kopieren"}</p></TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                    </SheetContent>
                </Sheet>
            </div>

            <div className="m-2 lg:ml-2 border rounded-xl relative h-full lg:h-auto bg-gradient-to-br from-background via-background to-muted/5 overflow-hidden shadow-inner flex-1 min-h-0">
                {disabled ? (
                    <div className="h-full justify-center items-center flex flex-col gap-4 p-8">
                        <div className="text-5xl mb-2">🔴</div>
                        <div className="font-semibold text-2xl">Konferenz beendet</div>
                        <div className="text-muted-foreground text-center max-w-md">Sie können die Konferenz verlassen oder den Chatverlauf sowie die Konferenzinformationen einsehen</div>
                    </div>
                ) : (
                    <>
                        {derivedRole === "VIEWER" ? (
                            <HLSViewer 
                                conferenceId={conference.id} 
                                currentPresenter={currentPresenter}
                            />
                        ) : (
                            <div className="h-full relative flex flex-col p-2 sm:p-3 md:p-4 gap-3 sm:gap-4">
                                {(() => {
                                    // Verwende participantStreams statt remoteStreams für Teilnehmer-Videos
                                    const participantEntries = Object.entries(participantStreams);
                                    const participantCount = participantEntries.length;
                                    const hasLocal = !!localStream;
                                    const totalParticipants = participantCount + (hasLocal ? 1 : 0);
                                    const hasScreenShare = !!activeScreenShare || isScreenSharing;

                                    // Layout mit Screenshare: Teilnehmer oben, Screenshare unten
                                    return (
                                        <>
                                            {/* Präsentator-Info */}
                                            {currentPresenter && (
                                                <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 bg-muted/30 rounded-lg mb-2">
                                                    <Crown className="w-4 h-4 text-yellow-500" />
                                                    <span className="text-sm font-medium">
                                                        Präsentator: {currentPresenter.firstName} {currentPresenter.lastName ?? ""}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Teilnehmer-Videos oben in horizontaler Leiste */}
                                            <div className={`flex-shrink-0 ${hasScreenShare ? 'h-32 sm:h-40' : 'flex-1 min-h-0'}`}>
                                                {totalParticipants === 0 ? (
                                                    <div className="h-full flex items-center justify-center">
                                                        <div className="text-center text-muted-foreground">
                                                            <div className="text-2xl mb-2">📹</div>
                                                            <div className="text-sm">Warte auf Teilnehmer...</div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="h-full flex gap-2 sm:gap-3 overflow-x-auto pb-2">
                                                        {hasLocal && (
                                                            <div className="flex-shrink-0 w-48 sm:w-56 md:w-64">
                                                                <VideoTile
                                                                    stream={localStream}
                                                                    title={isCurrentUserPresenter ? "Du (Präsentator)" : (derivedRole === "ORGANIZER" ? "Du (Organizer)" : derivedRole === "QUESTIONER" ? "Du (Fragesteller)" : "Du")}
                                                                    mutedByDefault={true}
                                                                    mirror={true}
                                                                    isLocal={true}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </div>
                                                        )}
                                                        {participantEntries.map(([peerId, stream]) => {
                                                            const peerUC = conference?.participants.find(p => p.userId === peerId);
                                                            const isPeerPresenter = peerUC?.isPresenter ?? false;
                                                            const isPeerQuestioner = (peerUC?.role as ExtendedRole | undefined) === "QUESTIONER";
                                                            let title = getUserName(peerId);
                                                            if (isPeerPresenter) title += " (Präsentator)";
                                                            if (isPeerQuestioner) title += " (Fragesteller)";
                                                            return (
                                                                <div key={peerId} className="flex-shrink-0 w-48 sm:w-56 md:w-64">
                                                                    <VideoTile
                                                                        stream={stream}
                                                                        title={title}
                                                                        mirror={false}
                                                                        mutedByDefault={false}
                                                                        isLocal={false}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Screenshare groß unten */}
                                            {hasScreenShare && (
                                                <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden bg-black">
                                                    {activeScreenShare ? (
                                                        <VideoTile
                                                            stream={activeScreenShare.stream}
                                                            title={`${activeScreenShare.userName} teilt Bildschirm`}
                                                            mirror={false}
                                                            mutedByDefault={false}
                                                            isLocal={false}
                                                            className="w-full h-full object-contain"
                                                        />
                                                    ) : isScreenSharing && localScreenStream ? (
                                                        <VideoTile
                                                            stream={localScreenStream}
                                                            title="Du teilst Bildschirm"
                                                            mirror={false}
                                                            mutedByDefault={true}
                                                            isLocal={true}
                                                            className="w-full h-full object-contain"
                                                        />
                                                    ) : null}
                                                    
                                                    {/* Screenshare-Controls */}
                                                    {(derivedRole === "ORGANIZER" || derivedRole === "PARTICIPANT") && (
                                                        <div className="absolute top-4 right-4 z-30">
                                                            <Button
                                                                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                                                                variant="outline"
                                                                size="sm"
                                                                className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background"
                                                            >
                                                                {isScreenSharing ? (
                                                                    <>
                                                                        <MonitorOff className="w-4 h-4 mr-2" />
                                                                        <span className="hidden sm:inline">Teilen beenden</span>
                                                                        <span className="sm:hidden">Beenden</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Monitor className="w-4 h-4 mr-2" />
                                                                        <span className="hidden sm:inline">Bildschirm teilen</span>
                                                                        <span className="sm:hidden">Teilen</span>
                                                                    </>
                                                                )}
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Wenn kein Screenshare: Normales Layout */}
                                            {!hasScreenShare && totalParticipants > 0 && (
                                                <div className="flex-1 min-h-0">
                                                    {totalParticipants <= 4 ? (
                                                        <div className="h-full grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                                            {hasLocal && (
                                                                <VideoTile
                                                                    stream={localStream}
                                                                    title={isCurrentUserPresenter ? "Du (Präsentator)" : (derivedRole === "ORGANIZER" ? "Du (Organizer)" : derivedRole === "QUESTIONER" ? "Du (Fragesteller)" : "Du")}
                                                                    mutedByDefault={true}
                                                                    mirror={true}
                                                                    isLocal={true}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            )}
                                                            {participantEntries.map(([peerId, stream]) => {
                                                                const peerUC = conference?.participants.find(p => p.userId === peerId);
                                                                const isPeerPresenter = peerUC?.isPresenter ?? false;
                                                                const isPeerQuestioner = (peerUC?.role as ExtendedRole | undefined) === "QUESTIONER";
                                                                let title = getUserName(peerId);
                                                                if (isPeerPresenter) title += " (Präsentator)";
                                                                if (isPeerQuestioner) title += " (Fragesteller)";
                                                                return (
                                                                    <VideoTile
                                                                        key={peerId}
                                                                        stream={stream}
                                                                        title={title}
                                                                        mirror={false}
                                                                        mutedByDefault={false}
                                                                        isLocal={false}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="h-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                                                            {hasLocal && (
                                                                <VideoTile
                                                                    stream={localStream}
                                                                    title={isCurrentUserPresenter ? "Du (Präsentator)" : (derivedRole === "ORGANIZER" ? "Du (Organizer)" : derivedRole === "QUESTIONER" ? "Du (Fragesteller)" : "Du")}
                                                                    mutedByDefault={true}
                                                                    mirror={true}
                                                                    isLocal={true}
                                                                    className="w-full aspect-video object-cover"
                                                                />
                                                            )}
                                                            {participantEntries.map(([peerId, stream]) => {
                                                                const peerUC = conference?.participants.find(p => p.userId === peerId);
                                                                const isPeerPresenter = peerUC?.isPresenter ?? false;
                                                                const isPeerQuestioner = (peerUC?.role as ExtendedRole | undefined) === "QUESTIONER";
                                                                let title = getUserName(peerId);
                                                                if (isPeerPresenter) title += " (Präsentator)";
                                                                if (isPeerQuestioner) title += " (Fragesteller)";
                                                                return (
                                                                    <VideoTile
                                                                        key={peerId}
                                                                        stream={stream}
                                                                        title={title}
                                                                        mirror={false}
                                                                        mutedByDefault={false}
                                                                        isLocal={false}
                                                                        className="w-full aspect-video object-cover"
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Screenshare-Button wenn kein Screenshare aktiv (nur für ORGANIZER und PARTICIPANT, nicht für QUESTIONER) */}
                                            {!hasScreenShare && (derivedRole === "ORGANIZER" || derivedRole === "PARTICIPANT") && (
                                                <div className="flex-shrink-0 flex justify-center">
                                                    <Button
                                                        onClick={startScreenShare}
                                                        variant="outline"
                                                        size="lg"
                                                        className="shadow-lg"
                                                    >
                                                        <Monitor className="w-5 h-5 mr-2" />
                                                        Bildschirm teilen
                                                    </Button>
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        )}
                    </>
                )}

                {/* Desktop Buttons - nur auf größeren Bildschirmen sichtbar */}
                <div className="hidden lg:flex absolute bottom-4 left-4 gap-3 flex-wrap z-30">
                    <Button asChild variant="outline" className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background border-2">
                        <Link href="/app" className="flex items-center gap-2">
                            <ArrowLeft className="w-4 h-4" />
                            Verlassen
                        </Link>
                    </Button>
                    
                    {derivedRole === "ORGANIZER" && (
                        <>
                            <Button 
                                disabled={conference.status === "ENDED"} 
                                onClick={() => setCommandOpen(true)}
                                className="shadow-lg backdrop-blur-sm"
                            >
                                Teilnehmer hinzufügen
                            </Button>
                            <CommandDialog open={commandOpen} onOpenChange={(o) => { setCommandOpen(o); if (!o) setSelectedUserIds([]); }}>
                                <div className="m-4 space-y-2">
                                    <h1 className="text-lg font-semibold">Teilnehmer auswählen</h1>
                                    <h3 className="text-sm text-muted-foreground">
                                        {remainingSlots > 0 ? `Du kannst noch ${remainingSlots - selectedUserIds.length} von ${remainingSlots} möglichen hinzufügen.` : "Maximale Teilnehmeranzahl erreicht."}
                                    </h3>

                                    {/* Aktueller Präsentator */}
                                    {currentPresenter && (
                                        <div className="pt-2">
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Präsentator</div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="default" className="flex items-center gap-1">
                                                    <Crown className="w-3 h-3" />
                                                    <span>{currentPresenter.firstName} {currentPresenter.lastName ?? ""}</span>
                                                </Badge>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => handleSetPresenter(null)}
                                                    className="h-6 text-xs"
                                                >
                                                    Entfernen
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {currentParticipants.length > 0 && (
                                        <div className="pt-2">
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Aktuelle Teilnehmer</div>
                                            <div className="flex flex-wrap gap-1">
                                                {currentParticipants.map((u) => {
                                                    const uc = conference?.participants.find(p => p.userId === u.id);
                                                    const role = uc?.role as ExtendedRole | undefined;
                                                    const isQuestioner = role === "QUESTIONER";
                                                    const isPresenter = uc?.isPresenter ?? false;
                                                    return (
                                                        <div key={u.id} className="flex items-center gap-1">
                                                            <Badge 
                                                                variant={isQuestioner ? "secondary" : isPresenter ? "default" : "outline"} 
                                                                className="flex items-center gap-1 pr-1"
                                                            >
                                                                {isPresenter && <Crown className="w-3 h-3" />}
                                                                {isQuestioner && <Mic className="w-3 h-3" />}
                                                                <span>{u.firstName} {u.lastName ?? ""}</span>
                                                                {isQuestioner && <span className="text-xs">(Fragesteller)</span>}
                                                            </Badge>
                                                            <div className="flex gap-0.5">
                                                                {!isPresenter && (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleSetPresenter(u.id)}
                                                                        className="h-6 px-1.5 text-xs"
                                                                        title="Als Präsentator setzen"
                                                                    >
                                                                        <Crown className="w-3 h-3" />
                                                                    </Button>
                                                                )}
                                                                {isQuestioner && (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleDeactivateQuestioner(u.id)}
                                                                        className="h-6 px-1.5 text-xs"
                                                                        title="Fragesteller deaktivieren"
                                                                    >
                                                                        <MicOff className="w-3 h-3" />
                                                                    </Button>
                                                                )}
                                                                {!isPresenter && (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleRemoveParticipant(u.id);
                                                                        }}
                                                                        className="hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                                                                        title="Teilnehmer entfernen"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Zuschauer */}
                                    {currentViewers.length > 0 && (
                                        <div className="pt-2">
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Zuschauer</div>
                                            <div className="flex flex-wrap gap-1">
                                                {currentViewers.map((u) => (
                                                    <Badge 
                                                        key={u.id} 
                                                        variant="outline" 
                                                        className="flex items-center gap-1"
                                                    >
                                                        <span>{u.firstName} {u.lastName ?? ""}</span>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleActivateQuestioner(u.id)}
                                                            className="h-5 px-1.5 text-xs ml-1"
                                                            title="Als Fragesteller aktivieren"
                                                        >
                                                            <Mic className="w-3 h-3" />
                                                        </Button>
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {selectedUserIds.length > 0 && (
                                        <div className="pt-2">
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Wird hinzugefügt</div>
                                            <div className="flex flex-wrap gap-1">
                                                {allUsers.filter((u) => selectedUserIds.includes(u.id)).map((u) => (
                                                    <Badge key={u.id} variant="secondary" className="cursor-pointer" onClick={() => toggleUser(u.id)}>
                                                        {u.firstName} {u.lastName ?? ""}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <Separator />

                                <CommandInput placeholder="User suchen..." />
                                <CommandList>
                                    <CommandEmpty>Keine User gefunden.</CommandEmpty>
                                    <CommandGroup heading="Users">
                                        {visibleUsers.map((u) => {
                                            const already = currentParticipants.some((p) => p.id === u.id);
                                            const checked = selectedUserIds.includes(u.id);
                                            return (
                                                <CommandItem
                                                    key={u.id}
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onSelect={() => !already && toggleUser(u.id)}
                                                    className="flex items-center gap-2"
                                                >
                                                    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}>
                                                        <Checkbox
                                                            checked={checked || already}
                                                            disabled={already || (!checked && (remainingSlots <= 0 || atLimit))}
                                                            onCheckedChange={() => toggleUser(u.id)}
                                                            className="flex justify-center items-center"
                                                        />
                                                    </div>
                                                    <span className="truncate">{u.firstName} {u.lastName ?? ""}</span>
                                                    {already && <span className="ml-auto text-xs text-muted-foreground">(bereits drin)</span>}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                </CommandList>

                                <div className="m-4 flex justify-end gap-2">
                                    <Button variant="ghost" onClick={() => setCommandOpen(false)}>Abbrechen</Button>
                                    <Button onClick={handleInviteSubmit} disabled={selectedUserIds.length === 0 || remainingSlots <= 0}>Hinzufügen</Button>
                                </div>
                            </CommandDialog>
                        </>
                    )}

                    <Sheet>
                        <SheetTrigger asChild>
                            <Button 
                                size="icon" 
                                variant="outline" 
                                className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background border-2 hidden lg:flex"
                            >
                                <Info className="w-4 h-4" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent>
                            <SheetHeader>
                                <SheetTitle>Konferenzinfo</SheetTitle>
                                <SheetDescription>Live-Stream mit Chat für alle Zuschauer dieser Konferenz.</SheetDescription>
                            </SheetHeader>
                            <div className="grid grid-cols-[min-content_1fr] items-center gap-2 px-4">
                                <div className="font-medium">Titel:</div>
                                <div className="text-right">{conference.title}</div>
                                <Separator className="col-span-2" />
                                <div className="font-medium">Beschreibung:</div>
                                <div className="text-right">{conference.description}</div>
                                <Separator className="col-span-2" />
                                <div className="font-medium">Von:</div>
                                <div className="text-right">{!!conference.startAt ? new Date(conference.startAt).toLocaleDateString("de-DE") : "Datum nicht verfügbar"}</div>
                                <div className="font-medium">Bis:</div>
                                <div className="text-right">{!!conference.endDate ? new Date(conference.endDate).toLocaleDateString("de-DE") : "Datum nicht verfügbar"}</div>
                                <Separator className="col-span-2" />
                                <div className="font-medium">Status:</div>
                                <div className="text-right">{mapStatus(conference.status)}</div>
                                <Separator className="col-span-2" />
                                <div className="font-medium">Organisator:</div>
                                <div className="text-right">
                                    <div className="flex flex-wrap justify-end gap-1">
                                        <Badge variant="outline">{organizer?.firstName} {organizer?.lastName ?? ""}</Badge>
                                    </div>
                                </div>
                                <Separator className="col-span-2" />
                                <div className="font-medium">Teilnehmer:</div>
                                <div className="text-right">
                                    <div className="flex flex-wrap justify-end gap-1">
                                        {currentParticipants.map((u) => <Badge key={u.id} variant="outline">{u.firstName} {u.lastName ?? ""}</Badge>)}
                                    </div>
                                </div>
                                <Separator className="col-span-2" />
                                <div className="font-medium">Link:</div>
                                <div className="text-right">
                                    <Tooltip>
                                        <TooltipTrigger asChild><Button onClick={async () => {
                                            try {
                                                await navigator.clipboard.writeText(`${window.location.origin}/app/${link}`);
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 2000);
                                            } catch (err) { console.error("Kopieren fehlgeschlagen:", err); }
                                        }} size="icon" variant="outline">
                                            {copied ? <Check /> : <Copy />}
                                        </Button></TooltipTrigger>
                                        <TooltipContent side="left"><p>{copied ? "Kopiert!" : "Link kopieren"}</p></TooltipContent>
                                    </Tooltip>
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>

            {/* Chat - auf mobil als Sheet, auf Desktop als Sidebar */}
            <div className="hidden lg:block m-2 lg:mx-2 border rounded-xl h-full flex-grow overflow-hidden bg-gradient-to-br from-background via-background to-muted/5 shadow-inner">
                <ConferenceChat conference={conference} disabled={disabled} />
            </div>
            
            {/* Mobile Chat Sheet */}
            <Sheet>
                <SheetTrigger asChild>
                    <Button 
                        className="lg:hidden fixed bottom-4 right-4 rounded-full w-14 h-14 shadow-2xl z-50 bg-primary hover:bg-primary/90"
                        size="icon"
                    >
                        <MessageCircle className="w-6 h-6 text-primary-foreground" />
                    </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[70vh] p-0">
                    <SheetHeader className="px-4 pt-4 pb-2 border-b">
                        <SheetTitle>Chat</SheetTitle>
                    </SheetHeader>
                    <div className="h-[calc(70vh-4rem)] overflow-hidden">
                        <ConferenceChat conference={conference} disabled={disabled} />
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
