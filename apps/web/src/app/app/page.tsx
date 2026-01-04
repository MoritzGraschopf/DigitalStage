"use client"

import {Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {Conference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import {Check, Copy} from "lucide-react";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {useWS} from "@/context/WebSocketContext";
import TextSeperator from "@/components/TextSeperator";

type ConferenceWithParticipants = Conference & { participants: { role: string, userId: string }[] };

export default function Home() {
    const [conferences, setConferences] = useState<ConferenceWithParticipants[]>([]);
    const {user, token} = useAuth();
    const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
    const [showEnded, setShowEnded] = useState(false);
    const ws = useWS()

    useEffect(() => {
        ws.send({type: "init", userId: user?.id, inConference: false})
    }, [ws, user?.id]);

    const fetchConferences = useCallback(async () => {
        try {
            const res = await fetch("/api/conference", {
                headers: {
                    "Authorization": "Bearer " + token,
                    "Content-Type": "application/json"
                }
            });
            const data = await res.json();
            setConferences(data.conferences);
        } catch (err) {
            console.error(err);
        }
    }, [token]);

    useEffect(() => {
        fetchConferences();
    }, [fetchConferences]);

    useEffect(() => {
        // Höre auf server:conference Nachrichten (wenn eine Konferenz aktualisiert wird)
        const unsubscribeConference = ws.on("server:conference", (msg) => {
            const con = msg as ConferenceWithParticipants;
            setConferences((prev) => {
                // Wenn bereits vorhanden → aktualisieren, sonst hinzufügen
                const existingIndex = prev.findIndex(c => c.id === con.id);
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = con;
                    return updated;
                }
                return [...prev, con];
            });
        });

        // Höre auf ConferenceParticipantsAdded Nachrichten (wenn eine neue Konferenz erstellt wurde)
        const unsubscribeParticipantsAdded = ws.on("server:ConferenceParticipantsAdded", () => {
            // Lade alle Konferenzen neu, wenn eine neue erstellt wurde
            fetchConferences();
        });

        return () => {
            unsubscribeConference();
            unsubscribeParticipantsAdded();
        };
    }, [ws, fetchConferences]);

    const handleCopy = async (link: string, id: string) => {
        try {
            await navigator.clipboard.writeText("https://digitalstage.liveroom.at:3000/app/" + link);
            setCopiedLinkId(id);
            setTimeout(() => setCopiedLinkId(null), 2000); // Reset nach 2 Sekunden
        } catch (err) {
            console.error('Kopieren fehlgeschlagen:', err);
        }
    };

    // Rollenbasierte Zuordnung für Abschnitte
    const { mine, participating, watching, ended } = useMemo(() => {
        // Prüft ob eine Konferenz beendet ist (durch Status oder Datum)
        const isConferenceEnded = (conference: ConferenceWithParticipants): boolean => {
            if (conference.status === "ENDED") return true;
            if (conference.endDate) {
                const endDate = new Date(conference.endDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                endDate.setHours(0, 0, 0, 0);
                return endDate < today;
            }
            return false;
        };

        const mine: ConferenceWithParticipants[] = [];
        const participating: ConferenceWithParticipants[] = [];
        const watching: ConferenceWithParticipants[] = [];
        const ended: ConferenceWithParticipants[] = [];
        const uid = user?.id;

        for (const c of conferences) {
            // Beendete Konferenzen in separaten Array
            if (isConferenceEnded(c)) {
                ended.push(c);
                continue;
            }

            const parts = c.participants ?? [];
            const isOrganizer =
                (c.organizerId && uid && c.organizerId === uid) ||
                parts.some(p => p.userId === uid && p.role === "ORGANIZER");
            const isParticipant = parts.some(p => p.userId === uid && p.role === "PARTICIPANT");
            const isViewer = parts.some(p => p.userId === uid && p.role === "VIEWER");

            if (isOrganizer) mine.push(c);
            else if (isParticipant) participating.push(c);
            else if (isViewer) watching.push(c);
            else watching.push(c); // Fallback: keine explizite Rolle -> "Zuschauen"
        }
        return { mine, participating, watching, ended };
    }, [conferences, user?.id]);

    const ConferenceCard = ({ conference }: { conference: ConferenceWithParticipants }) => (
        <Card key={conference.id}>
            <CardHeader>
                <CardTitle>{conference.title}</CardTitle>
                <CardDescription>
                    {conference.startAt && conference.endDate ? (
                        <>
                            Von {new Date(conference.startAt).toLocaleDateString("de-DE")} bis{" "}
                            {new Date(conference.endDate).toLocaleDateString("de-DE")}
                        </>
                    ) : (
                        "Datum nicht verfügbar"
                    )}
                </CardDescription>
                <CardAction>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                onClick={() => handleCopy(conference.link, conference.id)}
                                size="icon"
                                variant="outline"
                            >
                                {copiedLinkId === conference.id ? <Check/> : <Copy/>}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>
                                {copiedLinkId === conference.id ? "Kopiert!" : "Link kopieren"}
                            </p>
                        </TooltipContent>
                    </Tooltip>
                </CardAction>
            </CardHeader>
            <CardContent>
                <p>{conference.description}</p>
            </CardContent>
            <CardFooter>
                <Button size="sm">
                    <Link href={`/app/${conference.link}`}>
                        Zur Konferenz
                    </Link>
                </Button>
            </CardFooter>
        </Card>
    )

    return (
        <>
            <div className="mx-2">
                <TextSeperator textContent="Meine (Admin)"/>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2 m-2">
                {mine.map(conference => (
                    <ConferenceCard key={conference.id} conference={conference}/>
                ))}
            </div>

            <div className="mx-2">
                <TextSeperator textContent="Präsentieren"/>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2 m-2">
                {participating.map(conference => (
                    <ConferenceCard key={conference.id} conference={conference}/>
                ))}
            </div>

            <div className="mx-2">
                <TextSeperator textContent="Zuschauen"/>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2 m-2">
                {watching.map(conference => (
                    <ConferenceCard key={conference.id} conference={conference}/>
                ))}
            </div>

            <div className="flex justify-center my-4">
                <Button onClick={() => setShowEnded(!showEnded)} variant="outline" size="sm">
                    {showEnded ? "Verberge beendete Konferenzen" : "Zeige beendete Konferenzen"}
                </Button>
            </div>

            {showEnded && (
                <>
                    <div className="mx-2 my-6">
                        <TextSeperator textContent="Beendete Konferenzen"/>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2 m-2 my-4">
                        {ended.map(conference => (
                            <Card key={conference.id} className="bg-muted text-muted-foreground">
                                <CardHeader>
                                    <CardTitle>{conference.title}</CardTitle>
                                    <CardDescription>
                                        {conference.startAt && conference.endDate ? (
                                            <>
                                                Von {new Date(conference.startAt).toLocaleDateString("de-DE")} bis{" "}
                                                {new Date(conference.endDate).toLocaleDateString("de-DE")}
                                            </>
                                        ) : (
                                            "Datum nicht verfügbar"
                                        )}
                                    </CardDescription>
                                    <CardAction>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    onClick={() => handleCopy(conference.link, conference.id)}
                                                    size="icon"
                                                    variant="outline"
                                                    className="opacity-50"
                                                >
                                                    {copiedLinkId === conference.id ? <Check/> : <Copy/>}
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>
                                                    {copiedLinkId === conference.id ? "Kopiert!" : "Link kopieren"}
                                                </p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </CardAction>
                                </CardHeader>
                                <CardContent>
                                    <p>{conference.description}</p>
                                </CardContent>
                                <CardFooter>
                                    <Button className="opacity-50" size="sm">
                                        <Link href={`/app/${conference.link}`}>
                                            Zur Konferenz
                                        </Link>
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}
