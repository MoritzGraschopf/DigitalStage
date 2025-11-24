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
};

export function VideoTile({
                              stream,
                              title,
                              mutedByDefault = false,
                              className = "",
                          }: VideoTileProps) {
    const ref = useRef<HTMLVideoElement | null>(null);
    const [muted, setMuted] = useState<boolean>(mutedByDefault);

    // falls mutedByDefault sich jemals ändert
    useEffect(() => {
        setMuted(mutedByDefault);
    }, [mutedByDefault]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // srcObject setzen/clearen
        el.srcObject = stream;
        el.muted = mutedByDefault; // autoplay-policy safe

        if (!stream) return;

        const onMeta = (): void => {
            console.log(
                "🎬 loadedmetadata",
                title,
                "tracks:",
                stream.getTracks().map(t => t.kind)
            );

            const p = el.play();
            if (p) {
                p.catch((err: DOMException) => {
                    console.warn("autoplay blocked", title, err.name, err.message);
                });
            }
        };

        const onAddTrack = (ev: MediaStreamTrackEvent): void => {
            console.log("➕ track added", title, ev.track.kind);
            // sobald ein Track da ist, nochmal play versuchen
            onMeta();
        };

        // Handler setzen
        stream.onaddtrack = onAddTrack;
        el.addEventListener("loadedmetadata", onMeta);

        // falls metadata schon da ist
        if (el.readyState >= 1) onMeta();

        return () => {
            // Handler entfernen
            stream.onaddtrack = null;
            el.removeEventListener("loadedmetadata", onMeta);
        };
    }, [stream, mutedByDefault, title]);

    return (
        <div className="border rounded-md overflow-hidden">
            <video
                ref={ref}
                autoPlay
                playsInline
                muted={muted}
                className={className}
            />
            <div className="px-2 py-1 text-xs text-muted-foreground flex items-center justify-between">
                <span className="truncate">{title}</span>

                {!mutedByDefault && (
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
        (async () => {
            try {
                const r = await fetch("/api/user");
                const data: User[] = await r.json();
                if (conference) setOrganizer(data.find(u => u.id === conference.organizerId) ?? null);
                setAllUsers(data);
            } catch (e) {
                console.error("Error fetching users:", e);
            }
        })();
    }, [conference]);


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
                                            mutedByDefault={true}
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
                                            mutedByDefault={true}
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
