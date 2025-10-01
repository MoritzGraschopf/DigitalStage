"use client"

import {use, useEffect, useMemo, useState} from "react";
import {Button} from "@/components/ui/button";
import {ArrowLeft, Check, Copy, Info, LoaderCircle} from "lucide-react";
import ConferenceChat from "@/components/ConferenceChat";
import {Conference, User} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import Link from "next/link";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger} from "@/components/ui/sheet";
import {Separator} from "@/components/ui/separator";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@/components/ui/command";
import {Checkbox} from "@/components/ui/checkbox";
import {Badge} from "@/components/ui/badge";

const mapStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
        SCHEDULED: "Geplant",
        ACTIVE: "Aktiv",
        ENDED: "Beendet",
    };
    return statusMap[status] || "Unbekannt";
};

export default function Page({params}: { params: Promise<{ link: string }> }) {
    const [disabled, setDisabled] = useState<boolean>(false);
    const [conference, setConference] = useState<Conference | null>(null);
    const [organizer, setOrganizer] = useState<User | null>(null);
    const [showText, setShowText] = useState(false);
    const [copied, setCopied] = useState(false);
    const {fetchWithAuth, user} = useAuth();
    const {link} = use(params);

    const [commandOpen, setCommandOpen] = useState(false);
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}/app/${link}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Kopieren fehlgeschlagen:", err);
        }
    };

    // Hinweistext nach 5s einblenden
    useEffect(() => {
        const timer = setTimeout(() => setShowText(true), 5000);
        return () => clearTimeout(timer);
    }, []);

    // Konferenz holen
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
    }, [link, fetchWithAuth]);

    // Users laden
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch("/api/user");
                const data = await res.json();

                if (!!conference) {
                    for (const d in data) {
                        if (data[d].id === conference.organizerId) {
                            setOrganizer(data[d]);
                            break;
                        }
                    }

                }

                setAllUsers(data as User[]);
            } catch (e) {
                console.error("Error fetching users:", e);
            }
        };
        fetchUsers();
    }, [conference]);

    // eigenen User ausblenden
    const visibleUsers = useMemo(
        () => allUsers.filter((u) => (user ? u.id !== user.id : true)),
        [allUsers, user]
    );

    // bereits vorhandene Teilnehmer aus der Konferenz (IDs → Users)
    const currentParticipants = useMemo(() => {
        if (!conference) return [] as User[];
        const parts = (conference as unknown as { participants?: { userId: string }[] })?.participants ?? [];
        const mapById = new Map(allUsers.map((u) => [u.id, u]));
        return parts
            .map((p) => mapById.get(p.userId))
            .filter((u): u is User => !!u)
            // Organizer nicht anzeigen
            .filter((u) => u.id !== conference.organizerId);
    }, [conference, allUsers]);

    // Slots & Limits
    const maxTotal = 10;
    const currentCount = currentParticipants.length;
    const remainingSlots = Math.max(0, maxTotal - currentCount);
    const atLimit = selectedUserIds.length >= remainingSlots && remainingSlots > 0;

    // Auswahl togglen (eigener User blockiert, Limit beachten)
    const toggleUser = (id: string) => {
        if (user && id === user.id) return;

        setSelectedUserIds((prev) => {
            const isSelected = prev.includes(id);
            if (isSelected) return prev.filter((x) => x !== id);

            if (remainingSlots <= 0) return prev; // kein Platz
            if (prev.length >= remainingSlots) return prev; // Limit erreicht

            // nicht doppelt hinzufügen & keine bereits Teilnehmenden
            const alreadyInConference = currentParticipants.some((p) => p.id === id);
            if (alreadyInConference) return prev;

            return [...prev, id];
        });
    };

    // Einladungen absenden
    const handleInviteSubmit = async () => {
        //TODO: Teilnehmer hinzufügen
        try {
            if (!conference) return;
            if (selectedUserIds.length === 0) {
                setCommandOpen(false);
                return;
            }
            await fetchWithAuth(`/api/conference/${conference.link}/participants`, {
                method: "POST",
                body: JSON.stringify({userIds: selectedUserIds}),
            })
            setSelectedUserIds([]);
            setCommandOpen(false);
        } catch (e) {
            console.error("Teilnehmer hinzufügen fehlgeschlagen:", e);
        }
    };

    if (!conference) {
        return (
            <div
                className="h-screen w-screen fixed top-0 left-0 z-[-1] flex justify-center items-center flex-col gap-2">
                <LoaderCircle className="animate-spin"/>
                {showText && (
                    <p className="text-muted-foreground">Die Konferenz ist möglicherweise nicht mehr verfügbar.</p>
                )}
            </div>
        );
    }

    return (
        <div
            className="grid grid-cols-[3fr_1fr] grid-rows-[min-content_1fr] h-screen w-screen fixed top-0 left-0 z-[-1] overflow-hidden">
            <div className="h-13"></div>
            <div></div>

            <div className="ml-2 border rounded-md relative h-full">
                {disabled && (
                    <div className="h-full justify-center items-center flex flex-col">
                        <div className="font-medium text-xl">Konferenz beendet</div>
                        <div className="text-muted-foreground">
                            Sie können die Konferenz verlassen oder den Chatverlauf sowie die Konferenzinformationen
                            einsehen
                        </div>
                    </div>
                )}

                <div className="absolute bottom-2 left-2 flex gap-2">
                    <Button asChild>
                        <Link href="/app">
                            <ArrowLeft/>
                            Verlassen
                        </Link>
                    </Button>

                    {conference.organizerId === user?.id && (
                        <>
                            <Button onClick={() => setCommandOpen(true)}>Teilnehmer hinzufügen</Button>

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
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Aktuelle
                                                Teilnehmer
                                            </div>
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
                                            <div className="mb-1 text-xs font-medium text-muted-foreground">Wird
                                                hinzugefügt
                                            </div>
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

                                <Separator/>

                                <CommandInput placeholder="User suchen..."/>
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
                                                            disabled={
                                                                alreadyInConference || (!checked && (remainingSlots <= 0 || atLimit))
                                                            }
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
                                    <Button onClick={handleInviteSubmit}
                                            disabled={selectedUserIds.length === 0 || remainingSlots <= 0}>
                                        Hinzufügen
                                    </Button>
                                </div>
                            </CommandDialog>
                        </>
                    )}


                    <Sheet>
                        <SheetTrigger asChild>
                            <Button size="icon" variant="outline">
                                <Info/>
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

                                <Separator className="col-span-2"/>

                                <div className="font-medium">Beschreibung:</div>
                                <div className="text-right">{conference.description}</div>

                                <Separator className="col-span-2"/>

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

                                <Separator className="col-span-2"/>

                                <div className="font-medium">Status:</div>
                                <div className="text-right">{mapStatus(conference.status)}</div>

                                <Separator className="col-span-2"/>

                                <div className="font-medium">Organisator:</div>
                                <div className="text-right">
                                    <div className="flex flex-wrap justify-end gap-1">
                                        <Badge variant="outline">
                                            {organizer?.firstName} {organizer?.lastName ?? ""}
                                        </Badge>
                                    </div>
                                </div>

                                <Separator className="col-span-2"/>

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

                                <Separator className="col-span-2"/>

                                <div className="font-medium">Link:</div>
                                <div className="text-right">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button onClick={handleCopy} size="icon" variant="outline">
                                                {copied ? <Check/> : <Copy/>}
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
                <ConferenceChat conference={conference} disabled={disabled}/>
            </div>
        </div>
    );
}
