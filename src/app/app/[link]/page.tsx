"use client"

import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {use, useEffect, useRef, useState} from "react";
import {useForm} from "react-hook-form"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {z} from "zod"
import {zodResolver} from "@hookform/resolvers/zod";
import {Input} from "@/components/ui/input";
import {ArrowLeft, Check, Copy, Info, LoaderCircle} from "lucide-react";
import ConferenceChat from "@/components/ConferenceChat";
import {Conference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import Link from "next/link";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger} from "@/components/ui/sheet";
import {Separator} from "@/components/ui/separator";
import {useWebRTC} from "@/lib/webRTC";
import { useWebSocket } from "@/context/WebSocketContext";
//import {useWebsocket} from "next/dist/client/dev/hot-reloader/app/use-websocket";

const participantSchema = z.object({
    password: z.string().min(8, {
        error: "Passwort muss mindestens 8 Zeichen lang sein"
    })
})

const mapStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
        SCHEDULED: "Geplant",
        ACTIVE: "Aktiv",
        ENDED: "Beendet",
    };

    return statusMap[status] || "Unbekannt";
};

function Video({stream, muted=false, className = ""}:
               {stream: MediaStream|null, muted?: boolean, className?: string}) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if(ref.current && stream)
            ref.current.srcObject = stream;
    }, [stream]);

    return <video ref={ref} autoPlay playsInline muted={muted} className={className}></video>
}

export default function Page({
                                 params,
                             }: {
    params: Promise<{ link: string }>
}) {
    const [disabled, setDisabled] = useState<boolean>(false)
    const [conference, setConference] = useState<Conference | null>(null)
    const [joined, setJoined] = useState(false)
    const [showText, setShowText] = useState(false);
    const [copied, setCopied] = useState(false);
    const [tabRole, setTabRole] = useState<"VIEWER" | "PARTICIPANT">("VIEWER");
    const {socket} = useWebSocket();
    const {fetchWithAuth, user} = useAuth()
    const {link} = use(params);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText("http://localhost:3000/app/" + link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000); // nach 2 Sekunden zurücksetzen
        } catch (err) {
            console.error('Kopieren fehlgeschlagen:', err);
        }
    };

    useEffect(() => {
        // Show text after 5 seconds
        const timer = setTimeout(() => {
            setShowText(true);
        }, 5000);

        return () => clearTimeout(timer); // Cleanup timer on component unmount
    });

    useEffect(() => {
        const fetchConference = async () => {
            try {
                const res = await fetchWithAuth<Conference>(`/api/conference/${link}`)
                if (res.status === "ENDED") setDisabled(true)
                setConference(res)
            } catch (err) {
                console.error(err)
            }
        }

        fetchConference().then()
    }, [link, fetchWithAuth]);

    const isOrganizer = !!conference && !!user?.id && conference.organizerId === user.id;
    const effectiveRole: 'VIEWER' | 'PARTICIPANT' | 'ORGANIZER' = isOrganizer? 'ORGANIZER' : tabRole;

    const form = useForm<z.infer<typeof participantSchema>>({
        resolver: zodResolver(participantSchema),
        defaultValues: {
            password: ""
        }
    })

    function onSubmit(values: z.infer<typeof participantSchema>) {
        setTabRole('PARTICIPANT');
        setJoined(true);
        console.log(values)
    }

    const { localStream, remoteStreams } = useWebRTC({
        socket,
        userId: user?.id ?? "anonymous",
        conferenceId: conference?.id ?? "",
        role: joined ? "PARTICIPANT" : "VIEWER",
    });

    if (!conference) {
        return (
            <div
                className="h-screen w-screen fixed top-0 left-0 z-[-1] flex justify-center items-center flex-col gap-2">
                <LoaderCircle className="animate-spin"/>
                {showText &&
                    <p className="text-muted-foreground">Die Konferenz ist möglicherweise nicht mehr verfügbar.</p>}
            </div>
        )
    }

    return joined ? (
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
                        {effectiveRole === "VIEWER" ? (
                            // TODO: Hier HLS-Player einbauen
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                Du bist <b>Zuschauer</b> – hier kommt der HLS-Player hin.
                            </div>
                        ) : (
                            // Organizer/Participant: WebRTC-Layout
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

                <div className="absolute bottom-2 left-2">
                    <Button asChild>
                        <Link href="/app">
                            <ArrowLeft />
                            Verlassen
                        </Link>
                    </Button>

                    <Sheet>
                        <SheetTrigger asChild>
                            <Button size="icon" variant="outline" className="ml-2">
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
                                    {!!conference.startAt ? new Date(conference.startAt).toLocaleDateString("de-DE") : "Datum nicht verfügbar"}
                                </div>

                                <div className="font-medium">Bis:</div>
                                <div className="text-right">
                                    {!!conference.endDate ? new Date(conference.endDate).toLocaleDateString("de-DE") : "Datum nicht verfügbar"}
                                </div>

                                <Separator className="col-span-2" />
                                <div className="font-medium">Status:</div>
                                <div className="text-right">{mapStatus(conference.status)}</div>

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
    ) : (
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
                                onClick={() => { setTabRole('PARTICIPANT'); setJoined(true); }}>
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
    )
}