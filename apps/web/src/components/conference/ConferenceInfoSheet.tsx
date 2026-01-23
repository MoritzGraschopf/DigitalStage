"use client";

import { useState } from "react";
import { User } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, Info } from "lucide-react";
import { ConferenceWithParticipants, mapStatus } from "@/lib/ConferenceTypes";

interface ConferenceInfoSheetProps {
    conference: ConferenceWithParticipants;
    organizer: User | null;
    currentParticipants: User[];
    link: string;
    trigger?: React.ReactNode;
}

export function ConferenceInfoSheet({ 
    conference, 
    organizer, 
    currentParticipants, 
    link,
    trigger 
}: ConferenceInfoSheetProps) {
    const [copied, setCopied] = useState(false);

    const defaultTrigger = (
        <Button size="icon" variant="ghost">
            <Info className="w-4 h-4" />
        </Button>
    );

    return (
        <Sheet>
            <SheetTrigger asChild>
                {trigger || defaultTrigger}
            </SheetTrigger>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>Konferenzinfo</SheetTitle>
                    <SheetDescription>Live-Stream mit Chat für alle Zuschauer dieser Konferenz.</SheetDescription>
                </SheetHeader>
                <div className="grid grid-cols-[min-content_1fr] items-center gap-2 px-4 mt-4">
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
                                <Button 
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(`${window.location.origin}/app/${link}`);
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 2000);
                                        } catch (err) { 
                                            console.error("Kopieren fehlgeschlagen:", err); 
                                        }
                                    }} 
                                    size="icon" 
                                    variant="outline"
                                >
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
    );
}
