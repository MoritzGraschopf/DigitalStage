"use client"

import React, {useEffect, useMemo, useState} from "react";
import {Separator} from "@/components/ui/separator";
import {Conference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import Link from "next/link";
import {Button} from "@/components/ui/button";
import {useWS} from "@/context/WebSocketContext";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {CalendarDays, Clock} from "lucide-react";

type ConferenceWithParticipants = Conference & { participants: { role: string, userId: string }[] };

const LOCALE = "de-AT";
const TZ = "Europe/Vienna";

// Formatter für Tooltip (voller Timestamp)
const dtf = new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TZ,
});
function toDate(v?: string | Date | null): Date | null {
    if (!v) return null;
    return v instanceof Date ? v : new Date(v);
}
function formatShort(d: Date | null): string {
    if (!d) return "—";
    const now = new Date();

    // Vergleiche auf Basis der Ziel-Zeitzone
    const dLocal = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
    const nowLocal = new Date(now.toLocaleString("en-US", { timeZone: TZ }));

    const sameDay = dLocal.toDateString() === nowLocal.toDateString();
    const tomorrow = new Date(nowLocal); tomorrow.setDate(nowLocal.getDate() + 1);
    const yesterday = new Date(nowLocal); yesterday.setDate(nowLocal.getDate() - 1);

    const time = dLocal.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: TZ });

    if (sameDay) return `Heute, ${time}`;
    if (dLocal.toDateString() === tomorrow.toDateString()) return `Morgen, ${time}`;
    if (dLocal.toDateString() === yesterday.toDateString()) return `Gestern, ${time}`;

    return dtf.format(dLocal);
}
function ConferenceChip({
                            href, title, whenLabel, whenDate,
                        }: {
    href: string;
    title: string;
    whenLabel: string;   // "Startet" | "Endete"
    whenDate: Date | null;
}) {
    const inner = (
        <div className="flex items-center gap-3 py-1">
            <div className="flex flex-col items-start leading-tight">
                <span className="text-sm font-medium">{title}</span>
                <Tooltip>
                    <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              {whenLabel === "Endete" ? <CalendarDays className="h-3 w-3"/> : <Clock className="h-3 w-3"/>}
                {whenLabel}: {formatShort(whenDate)}
            </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <span className="text-xs">{whenDate ? dtf.format(whenDate) : "—"}</span>
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>
    );

    return (
        <Button asChild variant="outline" size="sm" className="text-sm py-6">
            <Link href={href}>{inner}</Link>
        </Button>
    )
}

const ActivityPage: React.FC = () => {
    const {user, token} = useAuth();
    const [conferences, setConferences] = useState<ConferenceWithParticipants[]>([]);
    const ws = useWS();

    const {mine, participating, ended} = useMemo(() => {
        let mine: ConferenceWithParticipants[] = [];
        let participating: ConferenceWithParticipants[] = [];
        const ended: ConferenceWithParticipants[] = [];
        const uid = user?.id;

        for (const c of conferences) {
            if (c.status === "ENDED") {
                const parts = c.participants ?? [];
                const isOrganizer =
                    (c.organizerId && uid && c.organizerId === uid) ||
                    parts.some(p => p.userId === uid && p.role === "ORGANIZER");
                const isParticipant = parts.some(p => p.userId === uid && p.role === "PARTICIPANT");
                const isViewer = parts.some(p => p.userId === uid && p.role === "VIEWER");
                if (isOrganizer || isParticipant || isViewer) ended.push(c);
                continue;
            }

            const parts = c.participants ?? [];
            const isOrganizer =
                (c.organizerId && uid && c.organizerId === uid) ||
                parts.some(p => p.userId === uid && p.role === "ORGANIZER");
            const isParticipant = parts.some(p => p.userId === uid && p.role === "PARTICIPANT");

            if (isOrganizer) mine.push(c);
            else if (isParticipant) participating.push(c);
        }

        // Sortierung: kommende ↑, beendete ↓
        const byStartAsc = (a: Conference, b: Conference) =>
            (toDate(a.startAt)?.getTime() ?? 0) - (toDate(b.startAt)?.getTime() ?? 0);
        const byEndDesc = (a: Conference, b: Conference) =>
            (toDate(b.endDate)?.getTime() ?? 0) - (toDate(a.endDate)?.getTime() ?? 0);

        mine = mine.filter(c => c.status !== "ENDED").sort(byStartAsc);
        participating = participating.filter(c => c.status !== "ENDED").sort(byStartAsc);
        ended.sort(byEndDesc);

        return {mine, participating, ended};
    }, [conferences, user?.id]);

    useEffect(() => {
        const fetchConferences = async () => {
            const res = await fetch("/api/conference", {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            const data = await res.json();
            setConferences(data.conferences);
        };
        fetchConferences();
    }, [token]);

    useEffect(() => {
        ws.on("server:conference", (msg) => {
            const con = msg as ConferenceWithParticipants;
            setConferences((prev) => (prev.some(c => c.id === con.id) ? prev : [...prev, con]));
        });
    }, [ws]);

    useEffect(() => {
        ws.send({type: "init", userId: user?.id, inConference: false});
    }, [ws, user?.id]);

    return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Aktivität</h1>
            <Separator className="my-2"/>

            {/* Meine Konferenzen */}
            <div>
                <h3 className="font-medium">Meine Konferenzen</h3>
                <div className="flex flex-wrap gap-2 mt-2">
                    {mine.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">
                            Keine bevorstehenden Konferenzen organisiert
                        </p>
                    ) : (
                        mine.map((c) => (
                            <ConferenceChip
                                key={c.id}
                                href={"/app/" + c.link}
                                title={c.title}
                                whenLabel="Startet"
                                whenDate={toDate(c.startAt)}
                            />
                        ))
                    )}
                </div>
            </div>

            <Separator className="my-2"/>

            {/* Teilnahmen */}
            <div>
                <h3 className="font-medium">Teilnahmen</h3>
                <div className="flex flex-wrap gap-2 mt-2">
                    {participating.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">
                            Keine bevorstehenden Teilnahmen
                        </p>
                    ) : (
                        participating.map((c) => (
                            <ConferenceChip
                                key={c.id}
                                href={"/app/" + c.link}
                                title={c.title}
                                whenLabel="Startet"
                                whenDate={toDate(c.startAt)}
                            />
                        ))
                    )}
                </div>
            </div>

            <Separator className="my-2"/>

            {/* Beendete Konferenzen */}
            <div>
                <h3 className="font-medium">Beendete Konferenzen</h3>
                <div className="flex flex-wrap gap-2 mt-2">
                    {ended.length === 0 ? (
                        <p className="text-muted-foreground text-sm italic">
                            Keine Konferenz organisiert oder teilgehabt
                        </p>
                    ) : (
                        ended.map((c) => (
                            <ConferenceChip
                                key={c.id}
                                href={"/app/" + c.link}
                                title={c.title}
                                whenLabel="Endete"
                                whenDate={toDate(c.endDate)}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default ActivityPage;
