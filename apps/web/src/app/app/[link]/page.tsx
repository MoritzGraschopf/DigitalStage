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
import { ArrowLeft, Check, Copy, Info, LoaderCircle } from "lucide-react";
import ConferenceChat from "@/components/ConferenceChat";

type ConferenceWithParticipants = Conference & { participants: UserConference[] };

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
                    // Prüfe nach kurzer Zeit, ob das Video wirklich spielt
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
            // Falls play() undefined zurückgibt, prüfe den Status
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
            // Handler entfernen
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
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 py-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white truncate flex-1">{title}</span>
                        {hasAudio && (
                            <button
                                className="ml-3 p-2 rounded-lg bg-black/40 hover:bg-black/60 text-white transition-all flex-shrink-0 backdrop-blur-sm hover:scale-110 active:scale-95"
                                onClick={() => setMuted(m => !m)}
                                title={muted ? "Ton an" : "Ton aus"}
                            >
                                {muted ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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

// eslint-disable-next-line
function DebugRemoteVideo({ stream }: { stream: MediaStream | null }) {
    const ref = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;

        if (!stream) {
            el.srcObject = null;
            return;
        }

        if (el.srcObject !== stream) {
            el.srcObject = stream;
        }

        el.muted = true;

        el.play().catch((err) => {
            console.warn("Debug video play failed:", err.name, err.message);
        });
    }, [stream]);

    return (
        <div className="border rounded-md m-2 p-1">
            <div className="text-xs text-muted-foreground mb-1">DEBUG Remote Video</div>
            <video
                ref={ref}
                autoPlay
                playsInline
                muted
                style={{ width: "320px", height: "240px", background: "black" }}
            />
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
        const off = ws.on("server:ConferenceParticipantsAdded", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) fetchConference();
        });
        return () => off();
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


    const derivedRole: "VIEWER" | "PARTICIPANT" | "ORGANIZER" = useMemo(() => {
        if (!conference || !user?.id) return "VIEWER";
        if (conference.organizerId === user.id) return "ORGANIZER";
        const uc = conference.participants.find(p => p.userId === user.id);
        return uc?.role === "PARTICIPANT" ? "PARTICIPANT" : "VIEWER";
    }, [conference, user?.id]);

    useEffect(() => {
        if (!user?.id || !conference?.id) return;

        const payloadKey = JSON.stringify({
            userId: user.id,
            conferenceId: conference.id,
            inConference: derivedRole !== "VIEWER",
        });

        if(lastInitRef.current === payloadKey)
            return;

        ws.send({ type: "init", userId: user.id, inConference: derivedRole !== "VIEWER", conferenceId: conference.id });
        lastInitRef.current = payloadKey;
    }, [ws, user?.id, conference?.id, derivedRole]);

    // Organizer-UI
    const visibleUsers = useMemo(
        () => allUsers.filter(u => (user ? u.id !== user.id : true)),
        [allUsers, user]
    );

    const currentParticipants = useMemo(() => {
        if (!conference) return [] as User[];
        const parts = conference.participants.filter(p => p.role === "PARTICIPANT");
        const mapById = new Map(allUsers.map(u => [u.id, u]));
        return parts
            .map(p => mapById.get(p.userId))
            .filter((u): u is User => !!u)
            .filter(u => u.id !== conference.organizerId);
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
            if (already) return prev;
            return [...prev, id];
        });
    };

    const handleInviteSubmit = async () => {
        try {
            if (!conference) return;
            if (selectedUserIds.length === 0) { setCommandOpen(false); return; }
            await fetchWithAuth(`/api/conference/${conference.link}/participants`, {
                method: "POST",
                body: JSON.stringify({ userIds: selectedUserIds }),
            });
            ws.send({ type: "ConferenceParticipantsAdded", conferenceId: conference.id, userIds: selectedUserIds, link: conference.link });
            setSelectedUserIds([]);
            setCommandOpen(false);
        } catch (e) {
            console.error("Teilnehmer hinzufügen fehlgeschlagen:", e);
        }
    };

    const rtcReady = !!user?.id && !!conference?.id;

    // --- WebRTC mit DB-basierter Rolle ---
    const { localStream, remoteStreams } = useWebRTC({
        socket,
        send,
        userId: rtcReady ? user.id : "",
        conferenceId: conference?.id ?? "",
        role: derivedRole,
    });

    if (!conference) {
        return (
            <div className="h-screen w-screen fixed top-0 left-0 z-[-1] flex justify-center items-center flex-col gap-2">
                <LoaderCircle className="animate-spin" />
                {showText && <p className="text-muted-foreground">Die Konferenz ist möglicherweise nicht mehr verfügbar.</p>}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-[3fr_1fr] grid-rows-[min-content_1fr] h-screen w-screen fixed top-0 left-0 z-[-1] overflow-hidden">
            <div className="h-13"></div>
            <div></div>

            <div className="ml-2 border rounded-xl relative h-full bg-gradient-to-br from-background via-background to-muted/5 overflow-hidden shadow-inner">
                {disabled ? (
                    <div className="h-full justify-center items-center flex flex-col gap-4 p-8">
                        <div className="text-5xl mb-2">🔴</div>
                        <div className="font-semibold text-2xl">Konferenz beendet</div>
                        <div className="text-muted-foreground text-center max-w-md">Sie können die Konferenz verlassen oder den Chatverlauf sowie die Konferenzinformationen einsehen</div>
                    </div>
                ) : (
                    <>
                        {derivedRole === "VIEWER" ? (
                            <div className="h-full flex items-center justify-center text-muted-foreground p-8">
                                <div className="text-center">
                                    <div className="text-6xl mb-4">👁️</div>
                                    <div className="text-xl font-medium mb-2">Du bist <b>Zuschauer</b></div>
                                    <div className="text-sm">Hier kommt der HLS-Player hin</div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full relative p-4 overflow-auto">
                                {(() => {
                                    const remoteEntries = Object.entries(remoteStreams);
                                    const remoteCount = remoteEntries.length;
                                    const hasLocal = !!localStream;
                                    const totalCount = remoteCount + (hasLocal ? 1 : 0);

                                    // Keine Teilnehmer
                                    if (totalCount === 0) {
                                        return (
                                            <div className="h-full flex items-center justify-center">
                                                <div className="text-center text-muted-foreground">
                                                    <div className="text-4xl mb-3">📹</div>
                                                    <div>Warte auf Teilnehmer...</div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    // Nur lokales Video
                                    if (hasLocal && remoteCount === 0) {
                                        return (
                                            <div className="h-full flex items-center justify-center p-8">
                                                <div className="w-full max-w-4xl">
                                                    <VideoTile
                                                        stream={localStream}
                                                        title={derivedRole === "ORGANIZER" ? "Du (Organizer)" : "Du"}
                                                        mutedByDefault={true}
                                                        mirror={true}
                                                        isLocal={true}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            </div>
                                        );
                                    }

                                    // 1-2 Teilnehmer: Side-by-side oder gestapelt
                                    if (totalCount <= 2) {
                                        return (
                                            <div className="h-full flex gap-4">
                                                {hasLocal && (
                                                    <div className="flex-1 min-w-0">
                                                        <VideoTile
                                                            stream={localStream}
                                                            title={derivedRole === "ORGANIZER" ? "Du (Organizer)" : "Du"}
                                                            mutedByDefault={true}
                                                            mirror={true}
                                                            isLocal={true}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                )}
                                                {remoteEntries.map(([peerId, stream]) => (
                                                    <div key={peerId} className="flex-1 min-w-0">
                                                        <VideoTile
                                                            stream={stream}
                                                            title={peerId}
                                                            mirror={false}
                                                            mutedByDefault={false}
                                                            isLocal={false}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    }

                                    // 3-4 Teilnehmer: 2x2 Grid
                                    if (totalCount <= 4) {
                                        return (
                                            <div className="h-full grid grid-cols-2 gap-4">
                                                {hasLocal && (
                                                    <VideoTile
                                                        stream={localStream}
                                                        title={derivedRole === "ORGANIZER" ? "Du (Organizer)" : "Du"}
                                                        mutedByDefault={true}
                                                        mirror={true}
                                                        isLocal={true}
                                                        className="w-full h-full object-cover"
                                                    />
                                                )}
                                                {remoteEntries.map(([peerId, stream]) => (
                                                    <VideoTile
                                                        key={peerId}
                                                        stream={stream}
                                                        title={peerId}
                                                        mirror={false}
                                                        mutedByDefault={false}
                                                        isLocal={false}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ))}
                                            </div>
                                        );
                                    }

                                    // 5+ Teilnehmer: Grid mit lokalem Video als Overlay
                                    return (
                                        <div className="h-full relative">
                                            {/* Remote Videos Grid */}
                                            <div className="h-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pr-4">
                                                {remoteEntries.map(([peerId, stream]) => (
                                                    <VideoTile
                                                        key={peerId}
                                                        stream={stream}
                                                        title={peerId}
                                                        mirror={false}
                                                        mutedByDefault={false}
                                                        isLocal={false}
                                                        className="w-full aspect-video object-cover"
                                                    />
                                                ))}
                                            </div>
                                            
                                            {/* Lokales Video als Overlay in rechter unterer Ecke */}
                                            {hasLocal && (
                                                <div className="absolute bottom-6 right-6 w-72 md:w-80 lg:w-96 z-20 shadow-2xl rounded-xl overflow-hidden">
                                                    <VideoTile
                                                        stream={localStream}
                                                        title={derivedRole === "ORGANIZER" ? "Du (Organizer)" : "Du"}
                                                        mutedByDefault={true}
                                                        mirror={true}
                                                        isLocal={true}
                                                        className="w-full aspect-video object-cover"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </>
                )}

                <div className="absolute bottom-4 left-4 flex gap-3 flex-wrap z-30">
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

                                    {currentParticipants.length > 0 && (
                                        <div className="pt-2">
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Aktuelle Teilnehmer</div>
                                            <div className="flex flex-wrap gap-1">
                                                {currentParticipants.map((u) => <Badge key={u.id} variant="outline">{u.firstName} {u.lastName ?? ""}</Badge>)}
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
                                className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background border-2"
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

            <div className="mx-2 border rounded-xl h-full flex-grow overflow-hidden bg-gradient-to-br from-background via-background to-muted/5 shadow-inner">
                <ConferenceChat conference={conference} disabled={disabled} />
            </div>
        </div>
    );
}
