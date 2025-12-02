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
//import {Volume2, VolumeX} from "lucide-react";

type ConferenceWithParticipants = Conference & { participants: UserConference[] };

const mapStatus = (status: string): string =>
    ({ SCHEDULED: "Geplant", ACTIVE: "Aktiv", ENDED: "Beendet" } as const)[status] ?? "Unbekannt";

type VideoTileProps = {
    stream: MediaStream | null;
    title: string;
    mutedByDefault?: boolean;
    className?: string;
    mirror?: boolean;
};

function VideoTile({
                              stream,
                              title,
                              mutedByDefault = false,
                              className = "",
                              mirror = false,
                          }: VideoTileProps) {
    const ref = useRef<HTMLVideoElement | null>(null);
    const [muted, setMuted] = useState<boolean>(mutedByDefault);
    const [needsUserAction, setNeedsUserAction] = useState(false);
    const isPlayingRef = useRef(false); // Verhindert Unterbrechungen während play()
    const currentStreamRef = useRef<MediaStream | null>(null);

    // falls mutedByDefault sich jemals ändert
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
        if (!el || isPlayingRef.current) return; // Verhindere mehrfache Aufrufe
        
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
                        // AbortError ignorieren und nochmal versuchen
                        if (err.name === "AbortError") {
                            console.warn("⚠️ Play interrupted, retrying...", title);
                            setTimeout(() => {
                                if (ref.current && !ref.current.paused) {
                                    setNeedsUserAction(false);
                                    isPlayingRef.current = false;
                                } else if (ref.current) {
                                    attemptPlay(); // Nochmal versuchen
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
    }, [title]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // srcObject nur setzen, wenn es sich geändert hat
        if (currentStreamRef.current !== stream) {
            currentStreamRef.current = stream;
            el.srcObject = stream;
        }
        
        el.muted = muted; // autoplay-policy safe

        // Nur play versuchen, wenn nicht gerade ein manueller Play läuft
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
            // sobald ein Track da ist, nochmal play versuchen
            onMeta();
        };

        const onPlaying = (): void => {
            console.log("▶️ playing", title);
            setNeedsUserAction(false);
        };

        const onPause = (): void => {
            console.log("⏸️ paused", title);
            // Nur als needsUserAction markieren, wenn es nicht absichtlich pausiert wurde
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
        <div className="relative border rounded-md overflow-hidden">
            <video
                ref={ref}
                autoPlay
                playsInline
                muted={muted}
                className={`${className} bg-black ${mirror ? "scale-x-[-1]" : ""}`}
            />
            {!hasVideo && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background/80">
                    Kein Video verfügbar
                </div>
            )}
            {needsUserAction && (
                <button
                    className="absolute inset-0 bg-black/80 text-white text-base font-medium flex items-center justify-center z-10 hover:bg-black/90 active:bg-black/95 transition-colors cursor-pointer"
                    onClick={handleUserPlay}
                    type="button"
                >
                    <div className="text-center">
                        <div className="text-2xl mb-2">▶️</div>
                        <div>Tippe zum Abspielen</div>
                    </div>
                </button>
            )}
            <div className="px-2 py-1 text-xs text-muted-foreground flex items-center justify-between">
                <span className="truncate">{title}</span>

                {hasAudio && (
                    <button
                        className="p-1"
                        onClick={() => setMuted(m => !m)}
                        title={muted ? "Ton an" : "Ton aus"}
                    >
                        {muted ? "🔇" : "🔊"}
                    </button>
                )}
            </div>
        </div>
    );
}

// eslint-disable-next-line
function DebugRemoteVideo({ stream }: { stream: MediaStream | null }) {
    const ref = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

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

    // eslint-disable-next-line
    const firstRemoteStream =
        Object.values(remoteStreams)[0] ?? null;

    useEffect(() => {
        console.log(
            "REMOTE STREAMS",
            Object.fromEntries(
                Object.entries(remoteStreams).map(([id, s]) => [
                    id,
                    s.getTracks().map(t => t.kind),
                ])
            )
        );
    }, [remoteStreams]);

    // 🔍 DEBUG: Detaillierte Video- und Stream-Analyse
    useEffect(() => {
        const debugInterval = setInterval(() => {
            const videos = document.querySelectorAll("video");
            console.group("🔍 VIDEO DEBUG REPORT");
            
            videos.forEach((video, idx) => {
                const stream = video.srcObject as MediaStream | null;
                const tracks = stream?.getTracks() || [];
                
                console.group(`Video ${idx + 1} (${video.title || "no title"})`);
                console.log("Element:", {
                    paused: video.paused,
                    muted: video.muted,
                    readyState: video.readyState,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight,
                    currentTime: video.currentTime,
                    autoplay: video.autoplay,
                    playsInline: video.playsInline,
                });
                
                if (stream) {
                    console.log("Stream:", {
                        id: stream.id,
                        active: stream.active,
                        trackCount: tracks.length,
                    });
                    
                    tracks.forEach((track, trackIdx) => {
                        console.log(`Track ${trackIdx + 1} (${track.kind}):`, {
                            id: track.id,
                            enabled: track.enabled,
                            muted: track.muted,
                            readyState: track.readyState,
                            settings: track.getSettings ? track.getSettings() : "N/A",
                            constraints: track.getConstraints ? track.getConstraints() : "N/A",
                        });
                        
                        // Prüfe ob Video-Track wirklich Frames liefert
                        if (track.kind === "video") {
                            // eslint-disable-next-line
                            const stats = (track as any).getStats ? (track as any).getStats() : null;
                            if (stats) {
                                console.log("Video Track Stats:", stats);
                            }
                        }
                    });
                } else {
                    console.warn("⚠️ No srcObject set!");
                }
                console.groupEnd();
            });
            
            console.log("Remote Streams State:", Object.keys(remoteStreams).map(userId => ({
                userId,
                stream: remoteStreams[userId],
                tracks: remoteStreams[userId]?.getTracks().map(t => ({
                    kind: t.kind,
                    id: t.id,
                    enabled: t.enabled,
                    muted: t.muted,
                    readyState: t.readyState,
                })),
            })));
            
            console.groupEnd();
        }, 5000); // Alle 5 Sekunden
        
        return () => clearInterval(debugInterval);
    }, [remoteStreams]);


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

            <div className="ml-2 border rounded-md relative h-full">
                {disabled ? (
                    <div className="h-full justify-center items-center flex flex-col">
                        <div className="font-medium text-xl">Konferenz beendet</div>
                        <div className="text-muted-foreground">Sie können die Konferenz verlassen oder den Chatverlauf sowie die Konferenzinformationen einsehen</div>
                    </div>
                ) : (
                    <>
                        {derivedRole === "VIEWER" ? (
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                Du bist <b> Zuschauer</b> – hier kommt der HLS-Player hin.
                            </div>
                        ) : (
                            <div className="h-full p-2 grid grid-rows-[auto_1fr] gap-2">
                                <div className="flex gap-2">
                                    <div className="w-64 border rounded-md overflow-hidden">
                                        <VideoTile
                                            stream={localStream}
                                            title={derivedRole === "ORGANIZER" ? "Du (Organizer)" : "Du"}
                                            mutedByDefault={false}
                                            mirror={false}
                                            className="w-full h-40 object-cover"
                                        />
                                        <div className="px-2 py-1 text-sm text-muted-foreground">{derivedRole === "ORGANIZER" ? "Du (Organizer)" : "Du"}</div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 overflow-auto">
                                    {Object.entries(remoteStreams).map(([peerId, stream]) => (
                                        <VideoTile
                                            key={peerId}
                                            stream={stream}
                                            title={peerId}
                                            mirror={false}
                                            mutedByDefault={false}
                                            className="w-full h-40 object-cover"
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}

                <div className="absolute bottom-2 left-2 flex gap-2">
                    <Button asChild><Link href="/app"><ArrowLeft />Verlassen</Link></Button>

                    {derivedRole === "ORGANIZER" && (
                        <>
                            <Button disabled={conference.status === "ENDED"} onClick={() => setCommandOpen(true)}>Teilnehmer hinzufügen</Button>
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
                        <SheetTrigger asChild><Button size="icon" variant="outline"><Info /></Button></SheetTrigger>
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

            <div className="mx-2 border rounded-md h-full flex-grow overflow-hidden">
                <ConferenceChat conference={conference} disabled={disabled} />
            </div>
        </div>
    );
}
