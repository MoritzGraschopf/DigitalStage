"use client"

import {Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import Link from "next/link";
import {useEffect, useState} from "react";
import {Conference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import {Check, Copy} from "lucide-react";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {Separator} from "@/components/ui/separator";
import {useWS} from "@/context/WebSocketContext";

export default function Home() {
    const [conferences, setConferences] = useState<Conference[]>([]);
    const {user, token} = useAuth();
    const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
    const [showEnded, setShowEnded] = useState(false);
    const ws = useWS()

    useEffect(() => {
        ws.send({type: "init", userId: user?.id, inConference: false})
    }, [ws, user?.id]);

    useEffect(() => {
        ws.on("server:conference", (msg) => {
            const con = msg as Conference;
            setConferences((prev) => {
                // wenn schon vorhanden → nicht erneut hinzufügen
                if (prev.some(c => c.id === con.id)) return prev;
                return [...prev, con];
            });
        });
    }, [ws]);

    useEffect(() => {
        const fetchConferences = async () => {
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
        };

        fetchConferences().then();
    }, [token]);

    const handleCopy = async (link: string, id: string) => {
        try {
            await navigator.clipboard.writeText("http://localhost:3000/app/" + link);
            setCopiedLinkId(id);
            setTimeout(() => setCopiedLinkId(null), 2000); // Reset nach 2 Sekunden
        } catch (err) {
            console.error('Kopieren fehlgeschlagen:', err);
        }
    };

    return (
        <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2 m-2">
                {conferences.filter(c => c.status !== "ENDED").map(conference => (
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
                ))}
            </div>

            <div className="mx-2">
                <Separator className="my-4"/>
            </div>

            <div className="flex justify-center my-4">
                <Button onClick={() => setShowEnded(!showEnded)} variant="outline" size="sm">
                    {showEnded ? "Verberge beendete Konferenzen" : "Zeige beendete Konferenzen"}
                </Button>
            </div>

            {showEnded && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2 m-2 my-4">
                    {conferences.filter(c => c.status === "ENDED").map(conference => (
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
            )}
        </>
    );
}
