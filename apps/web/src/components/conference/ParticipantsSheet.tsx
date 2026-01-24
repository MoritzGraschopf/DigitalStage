"use client";

import { User } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Crown, Mic, MicOff, Users, X } from "lucide-react";
import { ConferenceWithParticipants, ExtendedRole, UserLite } from "@/lib/ConferenceTypes";

interface ParticipantsSheetProps {
    webrtcParticipants: Array<{
        userId: string;
        name: string;
        role: ExtendedRole;
        isPresenter: boolean;
        isQuestioner: boolean;
        isMuted: boolean;
        isLocal: boolean;
    }>;
    derivedRole: ExtendedRole;
    organizer: User | null;
    currentPresenter: User | null;
    conference: ConferenceWithParticipants;
    userById: Record<string, UserLite>;
    currentParticipants: User[];
    currentViewers: UserLite[];
    selectedUserIds: string[];
    setSelectedUserIds: (ids: string[] | ((prev: string[]) => string[])) => void;
    inviteQuery: string;
    setInviteQuery: (query: string) => void;
    visibleUsers: UserLite[];
    remainingSlots: number;
    atLimit: boolean;
    toggleUser: (id: string) => void;
    handleInviteSubmit: () => Promise<void>;
    handleRemoveParticipant: (userId: string) => Promise<void>;
    handleSetPresenter: (userId: string | null) => Promise<void>;
    handleActivateQuestioner: (userId: string) => Promise<void>;
    handleDeactivateQuestioner: (userId: string) => Promise<void>;
    trigger?: React.ReactNode;
}

export function ParticipantsSheet({
    webrtcParticipants,
    derivedRole,
    organizer,
    currentPresenter,
    conference,
    userById,
    currentParticipants,
    currentViewers,
    selectedUserIds,
    setSelectedUserIds,
    inviteQuery,
    setInviteQuery,
    visibleUsers,
    remainingSlots,
    atLimit,
    toggleUser,
    handleInviteSubmit,
    handleRemoveParticipant,
    handleSetPresenter,
    handleActivateQuestioner,
    handleDeactivateQuestioner,
    trigger,
}: ParticipantsSheetProps) {
    const defaultTrigger = (
        <Button variant="outline" className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background border-2">
            <Users className="w-4 h-4 mr-2" />
            Teilnehmer ({webrtcParticipants.length})
        </Button>
    );

    return (
        <Sheet>
            <SheetTrigger asChild>
                {trigger || defaultTrigger}
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-96 overflow-y-auto px-4 pb-4">
                <SheetHeader className="mb-8">
                    <SheetTitle>Teilnehmerübersicht</SheetTitle>
                    <SheetDescription className="mt-2 mb-6">
                        Alle aktiven WebRTC-Verbindungen in dieser Konferenz
                    </SheetDescription>
                </SheetHeader>
                <div className="space-y-4 mb-6">
                    {webrtcParticipants.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                            <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>Keine aktiven Teilnehmer</p>
                        </div>
                    ) : (
                        webrtcParticipants.map((participant) => {
                            const roleLabel = participant.isPresenter 
                                ? "Präsentator" 
                                : participant.isQuestioner 
                                ? "Fragesteller" 
                                : participant.role === "ORGANIZER"
                                ? "Organizer"
                                : "Teilnehmer";
                            
                            return (
                                <div 
                                    key={participant.userId}
                                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                                >
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="flex-shrink-0">
                                            {participant.isPresenter ? (
                                                <Crown className="w-5 h-5 text-yellow-500" />
                                            ) : participant.isQuestioner ? (
                                                <Mic className="w-5 h-5 text-blue-500" />
                                            ) : participant.role === "ORGANIZER" ? (
                                                <Crown className="w-5 h-5 text-purple-500" />
                                            ) : (
                                                <div className="w-5 h-5 rounded-full bg-muted" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium truncate">
                                                    {participant.name}
                                                    {participant.isLocal && " (Du)"}
                                                </span>
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                {roleLabel}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0 ml-2">
                                        {participant.isMuted ? (
                                            <MicOff className="w-5 h-5 text-muted-foreground" />
                                        ) : (
                                            <Mic className="w-5 h-5 text-green-500" />
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {derivedRole === "ORGANIZER" && (
                    <>
                        <Separator className="my-8" />
                        
                        <div className="space-y-8">
                            <div className="space-y-3 mb-6">
                                <h3 className="text-sm font-medium">Verwaltung</h3>
                                <p className="text-xs text-muted-foreground mt-2">
                                    {remainingSlots > 0 ? `Du kannst noch ${remainingSlots - selectedUserIds.length} von ${remainingSlots} möglichen hinzufügen.` : "Maximale Teilnehmeranzahl erreicht."}
                                </p>
                            </div>

                            {organizer && (
                                <div className="space-y-3 mb-6">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        <Crown className="w-4 h-4 text-purple-500" />
                                        <span>Organizer</span>
                                    </div>
                                    <div className="p-3 rounded-lg border bg-card flex items-center justify-between hover:bg-accent/50 transition-colors">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            {currentPresenter?.id === organizer.id ? (
                                                <Crown className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                                            ) : (
                                                <Crown className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">{organizer.firstName} {organizer.lastName ?? ""}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    Organizer
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            {currentPresenter?.id === organizer.id && (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleSetPresenter(null)}
                                                            className="h-8 w-8 p-0"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Präsentator entfernen</TooltipContent>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {currentPresenter && currentPresenter.id !== organizer?.id && (
                                <div className="space-y-3 mb-6">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        <Crown className="w-4 h-4 text-yellow-500" />
                                        <span>Präsentator</span>
                                    </div>
                                    <div className="p-3 rounded-lg border bg-card flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-2">
                                            <Crown className="w-4 h-4 text-yellow-500" />
                                            <span className="font-medium">{currentPresenter.firstName} {currentPresenter.lastName ?? ""}</span>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleSetPresenter(null)}
                                            className="text-xs"
                                        >
                                            Entfernen
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {currentParticipants.length > 0 && (
                                <div className="space-y-3 mb-6">
                                    <div className="text-sm font-medium">Aktuelle Teilnehmer ({currentParticipants.length})</div>
                                    <div className="space-y-2 mt-2">
                                        {currentParticipants.map((u) => {
                                            const uc = conference?.participants.find(p => p.userId === u.id);
                                            const role = uc?.role as ExtendedRole | undefined;
                                            const isPresenter = uc?.isPresenter ?? false;
                                            const isQuestioner = !isPresenter && role === "QUESTIONER";
                                            return (
                                                <div key={u.id} className="p-3 rounded-lg border bg-card flex items-center justify-between hover:bg-accent/50 transition-colors">
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        {isPresenter ? (
                                                            <Crown className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                                                        ) : isQuestioner ? (
                                                            <Mic className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                                        ) : (
                                                            <div className="w-4 h-4 rounded-full bg-muted flex-shrink-0" />
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-medium truncate">{u.firstName} {u.lastName ?? ""}</div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {isPresenter ? "Präsentator" : isQuestioner ? "Fragesteller" : "Teilnehmer"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                        {!isPresenter && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleSetPresenter(u.id)}
                                                                        className="h-8 w-8 p-0"
                                                                    >
                                                                        <Crown className="w-4 h-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Als Präsentator setzen</TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                        {!isQuestioner && !isPresenter && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleActivateQuestioner(u.id)}
                                                                        className="h-8 w-8 p-0"
                                                                    >
                                                                        <Mic className="w-4 h-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Als Fragesteller aktivieren</TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                        {isQuestioner && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleDeactivateQuestioner(u.id)}
                                                                        className="h-8 w-8 p-0"
                                                                    >
                                                                        <MicOff className="w-4 h-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Fragesteller deaktivieren</TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                        {!isPresenter && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => handleRemoveParticipant(u.id)}
                                                                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                                                    >
                                                                        <X className="w-4 h-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Teilnehmer entfernen</TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {currentViewers.length > 0 && (
                                <div className="space-y-3 mb-6">
                                    <div className="text-sm font-medium">Zuschauer ({currentViewers.length})</div>
                                    <div className="space-y-2 mt-2">
                                        {currentViewers.map((u) => (
                                            <div key={u.id} className="p-3 rounded-lg border bg-card flex items-center justify-between hover:bg-accent/50 transition-colors">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className="w-4 h-4 rounded-full bg-muted flex-shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium truncate">{u.firstName} {u.lastName ?? ""}</div>
                                                        <div className="text-xs text-muted-foreground">Zuschauer</div>
                                                    </div>
                                                </div>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleActivateQuestioner(u.id)}
                                                            className="h-8 w-8 p-0"
                                                        >
                                                            <Mic className="w-4 h-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Als Fragesteller aktivieren</TooltipContent>
                                                </Tooltip>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selectedUserIds.length > 0 && (
                                <div className="space-y-3 mb-6">
                                    <div className="text-sm font-medium">Wird hinzugefügt ({selectedUserIds.length})</div>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {selectedUserIds.map((id) => {
                                            const u = userById[id] || visibleUsers.find(r => r.id === id);
                                            if (!u) return null;
                                            return (
                                                <Badge key={u.id} variant="secondary" className="cursor-pointer hover:bg-secondary/80" onClick={() => toggleUser(u.id)}>
                                                    {u.firstName} {u.lastName ?? ""}
                                                    <X className="w-3 h-3 ml-1" />
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <Separator className="my-8" />

                            <div className="space-y-3 mb-6">
                                <div className="text-sm font-medium">Neue Teilnehmer hinzufügen</div>
                                <Command className="rounded-lg border mt-2">
                                    <CommandInput 
                                        placeholder="User suchen..." 
                                        value={inviteQuery}
                                        onValueChange={setInviteQuery}
                                    />
                                    <CommandList className="max-h-[200px]">
                                        <CommandEmpty>Keine User gefunden.</CommandEmpty>
                                        <CommandGroup heading="Verfügbare User">
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
                                                        {already && <span className="ml-auto text-xs text-muted-foreground">(bereits Teilnehmer)</span>}
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </div>

                            <div className="flex justify-end gap-2 pt-6 mt-4">
                                <Button variant="ghost" onClick={() => setSelectedUserIds([])}>Abbrechen</Button>
                                <Button onClick={handleInviteSubmit} disabled={selectedUserIds.length === 0 || remainingSlots <= 0}>
                                    {selectedUserIds.length > 0 ? `${selectedUserIds.length} hinzufügen` : "Hinzufügen"}
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
