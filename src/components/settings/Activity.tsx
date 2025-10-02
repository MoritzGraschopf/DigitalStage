"use client"

import React, {useEffect, useMemo, useState} from "react";
import {Separator} from "@/components/ui/separator";
import {Conference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import Link from "next/link";
import {Button} from "@/components/ui/button";
import {useWS} from "@/context/WebSocketContext";

type ConferenceWithParticipants = Conference & { participants: { role: string, userId: string }[] };

const ActivityPage: React.FC = () => {
    const { user, token } = useAuth();
    const [conferences, setConferences] = useState<ConferenceWithParticipants[]>([])
    const ws = useWS()

    const { mine, participating, ended } = useMemo(() => {
        let mine: ConferenceWithParticipants[] = [];
        let participating: ConferenceWithParticipants[] = [];
        const ended: ConferenceWithParticipants[] = [];
        const uid = user?.id;

        for (const c of conferences) {
            if (c.status === "ENDED") {
                ended.push(c);
                continue;
            }
            const parts = c.participants ?? [];
            const isOrganizer =
                (c.organizerId && uid && c.organizerId === uid) ||
                parts.some(p => p.userId === uid && p.role === "ORGANIZER");
            const isParticipant = parts.some(p => p.userId === uid && p.role === "PARTICIPANT");

            if (isOrganizer) mine.push(c);
            else if (isParticipant) participating.push(c); // Fallback: keine explizite Rolle -> “Zuschauen”
        }

        mine = mine.filter(c => c.status !== "ENDED");
        participating = participating.filter(c => c.status !== "ENDED");
        return { mine, participating, ended };
    }, [conferences, user?.id]);
    
    useEffect(() => {
        const fetchConferences = async () => {
            const res = await fetch('/api/conference', {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                }
            })
            const data = await res.json()
            setConferences(data.conferences)
        }

        fetchConferences()
    }, [token])

    useEffect(() => {
        ws.on("server:conference", (msg) => {
            const con = msg as ConferenceWithParticipants;
            setConferences((prev) => {
                // wenn schon vorhanden → nicht erneut hinzufügen
                if (prev.some(c => c.id === con.id)) return prev;
                return [...prev, con];
            });
        });
    }, [ws]);

    useEffect(() => {
        ws.send({type: "init", userId: user?.id, inConference: false})
    }, [ws, user?.id]);

    return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Aktivität</h1>

            <Separator className="my-2"/>

            <div>
                <h3 className="font-medium">Meine Konferenzen</h3>
                <div className="flex flex-wrap gap-1 mt-2">
                    {mine.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">Keine bevorstehenden Konferenzen organisiert</p>
                    ) : mine.map((conference) => (
                        <Button key={conference.id} variant="outline" size="sm" className="text-sm" asChild>
                            <Link href={"/app/" + conference.link}>
                                {conference.title}
                            </Link>
                        </Button>
                    ))}
                </div>
            </div>

            <Separator className="my-2"/>

            <div>
                <h3 className="font-medium">Teilnahmen</h3>
                <div className="flex flex-wrap gap-1 mt-2">
                    {participating.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">Keine bevorstehenden Teilnahmen</p>
                    ) : participating.map((conference) => (
                        <Button key={conference.id} variant="outline" size="sm" className="text-sm" asChild>
                            <Link href={"/app/" + conference.link}>
                                {conference.title}
                            </Link>
                        </Button>
                    ))}
                </div>
            </div>

            <Separator className="my-2"/>

            <div>
                <h3 className="font-medium">Beendete Konferenzen</h3>
                <div className="flex flex-wrap gap-1 mt-2">
                    {ended.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">Keine Konferenz organiesiert oder teilgehabt</p>
                    ) : ended.map((conference) => (
                        <Button disabled key={conference.id} variant="outline" size="sm" className="text-sm" asChild>
                            <Link href={"/app/" + conference.link}>
                                {conference.title}
                            </Link>
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default ActivityPage