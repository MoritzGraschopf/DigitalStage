"use client"

import { use, useEffect, useMemo, useRef, useState } from "react";

// Auth & Data
import { useAuth } from "@/context/AuthContext";
import { Conference, User } from "@prisma/client";

// WebSocket (beide Hooks beibehalten, wie in deinen Originalen)
import { useWebSocket } from "@/context/WebSocketContext";
import { useWS } from "@/context/WebSocketContext";

// WebRTC
import { useWebRTC } from "@/lib/webRTC";

// UI: Forms & Inputs
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

// UI: Layout
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
    CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

// Icons
import { ArrowLeft, Check, Copy, Info, LoaderCircle } from "lucide-react";

// Chat
import ConferenceChat from "@/components/ConferenceChat";

// -----------------------------
// Helpers & small components
// -----------------------------
const participantSchema = z.object({
    password: z.string().min(8, { error: "Passwort muss mindestens 8 Zeichen lang sein" })
});

const mapStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
        SCHEDULED: "Geplant",
        ACTIVE: "Aktiv",
        ENDED: "Beendet",
    };
    return statusMap[status] || "Unbekannt";
};

function Video({
                   stream,
                   muted = false,
                   className = ""
               }: { stream: MediaStream | null, muted?: boolean, className?: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if (ref.current && stream) ref.current.srcObject = stream;
    }, [stream]);
    return <video ref={ref} autoPlay playsInline muted={muted} className={className}></video>
}

// -----------------------------
// Page
// -----------------------------
export default function Page({ params }: { params: Promise<{ link: string }> }) {
    const { link } = use(params);

    // State: common
    const [disabled, setDisabled] = useState<boolean>(false);
    const [conference, setConference] = useState<Conference | null>(null);
    const [organizer, setOrganizer] = useState<User | null>(null);
    const [showText, setShowText] = useState(false);
    const [copied, setCopied] = useState(false);

    // State: join flow (non-organizer)
    const [joined, setJoined] = useState(false);
    const [tabRole, setTabRole] = useState<"VIEWER" | "PARTICIPANT">("VIEWER");

    // State: invite dialog (organizer)
    const [commandOpen, setCommandOpen] = useState(false);
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    // Contexts
    const { fetchWithAuth, user } = useAuth();
    const { socket } = useWebSocket();
    const ws = useWS();

    // Derived
    const isOrganizer = !!conference && !!user?.id && conference.organizerId === user.id;

    // Show hint after 5s
    useEffect(() => {
        const timer = setTimeout(() => setShowText(true), 5000);
        return () => clearTimeout(timer);
    }, []);

    // Fetch conference (+ react to server event)
    useEffect(() => {
        const fetchConference = async () => {
            try {
                const res = await fetchWithAuth<Conference>(`/api/conference/${link}`);
                if (res.status === "ENDED") setDisabled(true);
                setConference(res);
            } catch (err) {
                console.error(err);
            }
        };
        fetchConference();

        // live update (beibehalten aus deiner zweiten Datei)
        ws.on("server:ConferenceParticipantsAdded", (msg) => {
            const formattedMsg = msg as { conferenceId: string };
            if (formattedMsg.conferenceId === conference?.id) {
                fetchConference();
            }
        });
    }, [link, fetchWithAuth, ws, conference?.id]);

    // Fetch users (for organizer UI)
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch("/api/user");
                const data: User[] = await res.json();

                if (!!conference) {
                    const org = data.find(u => u.id === conference.organizerId) || null;
                    setOrganizer(org);
                }
                setAllUsers(data);
            } catch (e) {
                console.error("Error fetching users:", e);
            }
        };
        fetchUsers();
    }, [conference]);

    // Organizer sieht direkt das Hauptlayout (kein Join-Screen)
    useEffect(() => {
        if (isOrganizer) {
            setJoined(true);
            setTabRole("PARTICIPANT"); // UI-Label egal; Rolle wird unten korrekt als "ORGANIZER" gesetzt
        }
    }, [isOrganizer]);

    // Form (nur für Teilnehmer-Join)
    const form = useForm<z.infer<typeof participantSchema>>({
        resolver: zodResolver(participantSchema),
        defaultValues: { password: "" }
    });

    function onSubmit(values: z.infer<typeof participantSchema>) {
        setTabRole('PARTICIPANT');
        setJoined(true);
        console.log(values);
    }

    // Copy link
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}/app/${link}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Kopieren fehlgeschlagen:", err);
        }
    };

    // User lists for organizer
    const visibleUsers = useMemo(
        () => allUsers.filter(u => (user ? u.id !== user.id : true)),
        [allUsers, user]
    );

    const currentParticipants = useMemo(() => {
        if (!conference) return [] as User[];
        const parts = (conference as unknown as { participants?: { userId: string }[] })?.participants ?? [];
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

            const alreadyInConference = currentParticipants.some(p => p.id === id);
            if (alreadyInConference) return prev;

            return [...prev, id];
        });
    };

    const handleInviteSubmit = async () => {
        try {
            if (!conference) return;
            if (selectedUserIds.length === 0) {
                setCommandOpen(false);
                return;
            }
            await fetchWithAuth(`/api/conference/${conference.link}/participants`, {
                method: "POST",
                body: JSON.stringify({ userIds: selectedUserIds }),
            });

            ws.send({
                type: "ConferenceParticipantsAdded",
                conferenceId: conference.id,
                userIds: selectedUserIds,
                link: conference.link,
            });

            setSelectedUserIds([]);
            setCommandOpen(false);
        } catch (e) {
            console.error("Teilnehmer hinzufügen fehlgeschlagen:", e);
        }
    };

    // --- WebRTC hook ---
    const computedRole: 'VIEWER' | 'PARTICIPANT' | 'ORGANIZER' =
        isOrganizer ? 'ORGANIZER' : (joined ? tabRole : 'VIEWER');

    const { localStream, remoteStreams } = useWebRTC({
        socket,
        userId: user?.id ?? "anonymous",
        conferenceId: conference?.id ?? "",
        role: computedRole,
    });

    // ---------- Render ----------
    if (!conference) {
        return (
            <div className="h-screen w-screen fixed top-0 left-0 z-[-1] flex justify-center items-center flex-col gap-2">
                <LoaderCircle className="animate-spin" />
                {showText && (
                    <p className="text-muted-foreground">Die Konferenz ist möglicherweise nicht mehr verfügbar.</p>
                )}
            </div>
        );
    }

    // Join screen für Nicht-Organizer
    if (!joined && !isOrganizer) {
        return (
            <div className="flex justify-center items-center h-screen w-screen fixed top-0 left-0 z-[-1]">
                <Tabs
                    defaultValue="viewer"
                    className="w-90"
                    onValueChange={(v) => setTabRole(v === "participant" ? "PARTICIPANT" : "VIEWER")}
                >
                    <TabsList className="w-full">
                        <TabsTrigger value="viewer">Zuschauer</TabsTrigger>
                        <TabsTrigger value="participant">Teilnehmer</TabsTrigger>
                    </TabsList>

                    <TabsContent value="viewer">
                        <Card>
                            <CardHeader>
                                <CardTitle>Zuschauer</CardTitle>
                                <CardDescription>Als Zuschauer beitreten</CardDescription>
                            </CardHeader>
                            <CardFooter>
                                <Button
                                    size="sm"
                                    className="w-full"
                                    onClick={() => { setTabRole('VIEWER'); setJoined(true); }}>
                                    Beitreten
                                </Button>
                            </CardFooter>
                        </Card>
                    </TabsContent>

                    <TabsContent value="participant">
                        <Card>
                            <CardHeader>
                                <CardTitle>Teilnehmer</CardTitle>
                                <CardDescription>Als Teilnehmer mit Kamera und Mikrofon beitreten</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Form {...form}>
                                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                        <FormField
                                            control={form.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Passwort</FormLabel>
                                                    <FormControl>
                                                        <Input type="text" {...field} autoComplete="off" />
                                                    </FormControl>
                                                    <FormDescription>
                                                        Passwort, welches vom Host festgelegt worden ist.
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <Button className="w-full" size="sm" type="submit">
                                            Beitreten
                                        </Button>
                                    </form>
                                </Form>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        );
    }

    // Hauptlayout (Organizer oder beigetretene Teilnehmer/Zuschauer)
    return (
        <div className="grid grid-cols-[3fr_1fr] grid-rows-[min-content_1fr] h-screen w-screen fixed top-0 left-0 z-[-1] overflow-hidden">
            <div className="h-13"></div>
            <div></div>

            <div className="ml-2 border rounded-md relative h-full">
                {disabled ? (
                    <div className="h-full justify-center items-center flex flex-col">
                        <div className="font-medium text-xl">Konferenz beendet</div>
                        <div className="text-muted-foreground">
                            Sie können die Konferenz verlassen oder den Chatverlauf sowie die Konferenzinformationen einsehen
                        </div>
                    </div>
                ) : (
                    <>
                        {computedRole === "VIEWER" ? (
                            // TODO: HLS-Player integrieren
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                Du bist <b>Zuschauer</b> – hier kommt der HLS-Player hin.
                            </div>
                        ) : (
                            // Organizer / Participant: WebRTC-Layout
                            <div className="h-full p-2 grid grid-rows-[auto_1fr] gap-2">
                                {/* Lokales Video */}
                                <div className="flex gap-2">
                                    <div className="w-64 border rounded-md overflow-hidden">
                                        <Video stream={localStream} muted className="w-full h-40 object-cover" />
                                        <div className="px-2 py-1 text-sm text-muted-foreground">
                                            {isOrganizer ? "Du (Organizer)" : "Du"}
                                        </div>
                                    </div>
                                </div>

                                {/* Remote-Videos */}
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 overflow-auto">
                                    {Object.entries(remoteStreams).map(([peerId, stream]) => (
                                        <div key={peerId} className="border rounded-md overflow-hidden">
                                            <Video stream={stream} className="w-full h-40 object-cover" />
                                            <div className="px-2 py-1 text-xs text-muted-foreground">{peerId}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Bottom-left controls */}
                <div className="absolute bottom-2 left-2 flex gap-2">
                    <Button asChild>
                        <Link href="/app">
                            <ArrowLeft />
                            Verlassen
                        </Link>
                    </Button>

                    {isOrganizer && (
                        <>
                            <Button disabled={conference.status === "ENDED"} onClick={() => setCommandOpen(true)}>
                                Teilnehmer hinzufügen
                            </Button>

                            <CommandDialog
                                open={commandOpen}
                                onOpenChange={(o) => {
                                    setCommandOpen(o);
                                    if (!o) setSelectedUserIds([]);
                                }}
                            >
                                <div className="m-4 space-y-2">
                                    <h1 className="text-lg font-semibold">Teilnehmer auswählen</h1>
                                    <h3 className="text-sm text-muted-foreground">
                                        {remainingSlots > 0
                                            ? `Du kannst noch ${remainingSlots - selectedUserIds.length} von ${remainingSlots} möglichen hinzufügen.`
                                            : "Maximale Teilnehmeranzahl erreicht."}
                                    </h3>

                                    {currentParticipants.length > 0 && (
                                        <div className="pt-2">
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Aktuelle Teilnehmer</div>
                                            <div className="flex flex-wrap gap-1">
                                                {currentParticipants.map((u) => (
                                                    <Badge key={u.id} variant="outline">
                                                        {u.firstName} {u.lastName ?? ""}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {selectedUserIds.length > 0 && (
                                        <div className="pt-2">
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Wird hinzugefügt</div>
                                            <div className="flex flex-wrap gap-1">
                                                {allUsers
                                                    .filter((u) => selectedUserIds.includes(u.id))
                                                    .map((u) => (
                                                        <Badge
                                                            key={u.id}
                                                            variant="secondary"
                                                            className="cursor-pointer"
                                                            onClick={() => toggleUser(u.id)}
                                                        >
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
                                            const alreadyInConference = currentParticipants.some((p) => p.id === u.id);
                                            const checked = selectedUserIds.includes(u.id);
                                            return (
                                                <CommandItem
                                                    key={u.id}
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onSelect={() => !alreadyInConference && toggleUser(u.id)}
                                                    className="flex items-center gap-2"
                                                >
                                                    <div
                                                        onClick={(e) => e.stopPropagation()}
                                                        onMouseDown={(e) => e.preventDefault()}
                                                    >
                                                        <Checkbox
                                                            checked={checked || alreadyInConference}
                                                            disabled={alreadyInConference || (!checked && (remainingSlots <= 0 || atLimit))}
                                                            onCheckedChange={() => toggleUser(u.id)}
                                                            className="flex justify-center items-center"
                                                        />
                                                    </div>
                                                    <span className="truncate">
                            {u.firstName} {u.lastName ?? ""}
                          </span>
                                                    {alreadyInConference && (
                                                        <span className="ml-auto text-xs text-muted-foreground">(bereits drin)</span>
                                                    )}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                </CommandList>

                                <div className="m-4 flex justify-end gap-2">
                                    <Button variant="ghost" onClick={() => setCommandOpen(false)}>
                                        Abbrechen
                                    </Button>
                                    <Button onClick={handleInviteSubmit} disabled={selectedUserIds.length === 0 || remainingSlots <= 0}>
                                        Hinzufügen
                                    </Button>
                                </div>
                            </CommandDialog>
                        </>
                    )}

                    <Sheet>
                        <SheetTrigger asChild>
                            <Button size="icon" variant="outline">
                                <Info />
                            </Button>
                        </SheetTrigger>
                        <SheetContent>
                            <SheetHeader>
                                <SheetTitle>Konferenzinfo</SheetTitle>
                                <SheetDescription>
                                    Live-Stream mit Chat für alle Zuschauer dieser Konferenz.
                                </SheetDescription>
                            </SheetHeader>
                            <div className="grid grid-cols-[min-content_1fr] items-center gap-2 px-4">
                                <div className="font-medium">Titel:</div>
                                <div className="text-right">{conference.title}</div>

                                <Separator className="col-span-2" />

                                <div className="font-medium">Beschreibung:</div>
                                <div className="text-right">{conference.description}</div>

                                <Separator className="col-span-2" />

                                <div className="font-medium">Von:</div>
                                <div className="text-right">
                                    {!!conference.startAt
                                        ? new Date(conference.startAt).toLocaleDateString("de-DE")
                                        : "Datum nicht verfügbar"}
                                </div>

                                <div className="font-medium">Bis:</div>
                                <div className="text-right">
                                    {!!conference.endDate
                                        ? new Date(conference.endDate).toLocaleDateString("de-DE")
                                        : "Datum nicht verfügbar"}
                                </div>

                                <Separator className="col-span-2" />

                                <div className="font-medium">Status:</div>
                                <div className="text-right">{mapStatus(conference.status)}</div>

                                <Separator className="col-span-2" />

                                <div className="font-medium">Organisator:</div>
                                <div className="text-right">
                                    <div className="flex flex-wrap justify-end gap-1">
                                        <Badge variant="outline">
                                            {organizer?.firstName} {organizer?.lastName ?? ""}
                                        </Badge>
                                    </div>
                                </div>

                                <Separator className="col-span-2" />

                                <div className="font-medium">Teilnehmer:</div>
                                <div className="text-right">
                                    <div className="flex flex-wrap justify-end gap-1">
                                        {currentParticipants.map((u) => (
                                            <Badge key={u.id} variant="outline">
                                                {u.firstName} {u.lastName ?? ""}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>

                                <Separator className="col-span-2" />

                                <div className="font-medium">Link:</div>
                                <div className="text-right">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button onClick={handleCopy} size="icon" variant="outline">
                                                {copied ? <Check /> : <Copy />}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="left">
                                            <p>{copied ? "Kopiert!" : "Link kopieren"}</p>
                                        </TooltipContent>
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
