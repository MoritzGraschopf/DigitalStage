"use client";

import { use, useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useWebSocket, useWS } from "@/context/WebSocketContext";
import { useWebRTC } from "@/lib/webRTC";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger} from "@/components/ui/sheet";
import { ArrowLeft, LoaderCircle, MessageCircle, Users, Info } from "lucide-react";
import ConferenceChat from "@/components/ConferenceChat";
import { HLSViewer } from "@/components/conference/HLSViewer";
import { ConferenceVideoLayout } from "@/components/conference/ConferenceVideoLayout";
import { ConferenceInfoSheet } from "@/components/conference/ConferenceInfoSheet";
import { ParticipantsSheet } from "@/components/conference/ParticipantsSheet";
import { useConference } from "@/hooks/conference/useConference";
import { useConferenceParticipants } from "@/hooks/conference/useConferenceParticipants";
import { useConferenceStreams } from "@/hooks/conference/useConferenceStreams";
import { ExtendedRole } from "@/lib/ConferenceTypes";
import { UserConference } from "@prisma/client";

export default function Page({ params }: { params: Promise<{ link: string }> }) {
    const { link } = use(params);

    const [showText, setShowText] = useState(false);
    const { user } = useAuth();
    const { socket, send } = useWebSocket();
    const ws = useWS();

    const {
        conference,
        disabled,
        organizer,
        userById,
        presence,
        derivedRole,
        currentPresenter,
        isCurrentUserPresenter,
        fetchConference,
    } = useConference(link);

    const {
        selectedUserIds,
        setSelectedUserIds,
        inviteQuery,
        setInviteQuery,
        visibleUsers,
        currentParticipants,
        currentViewers,
        remainingSlots,
        atLimit,
        toggleUser,
        handleInviteSubmit,
        handleRemoveParticipant,
        handleSetPresenter,
        handleActivateQuestioner,
        handleDeactivateQuestioner,
    } = useConferenceParticipants(conference, userById, presence, fetchConference);

    useEffect(() => {
        const t = setTimeout(() => setShowText(true), 5000);
        return () => clearTimeout(t);
    }, []);

    const rtcReady = !!user?.id && !!conference?.id;

    const { localStream, remoteStreams, startScreenShare, stopScreenShare, isScreenSharing, localScreenStream, audioMuteStatus } = useWebRTC({
        socket,
        send,
        userId: rtcReady ? user.id : "",
        conferenceId: conference?.id ?? "",
        role: derivedRole,
        reconnectCount: ws.reconnectCount,
        presenterUserId: currentPresenter?.id || null,
    });

    const {
        participantStreams,
        activeScreenShare,
        webrtcParticipants,
        getUserName,
    } = useConferenceStreams(
        localStream,
        remoteStreams,
        isScreenSharing,
        localScreenStream,
        audioMuteStatus,
        user,
        conference,
        userById,
        derivedRole,
        isCurrentUserPresenter
    );

    if (!conference) {
        return (
            <div className="h-screen w-screen fixed top-0 left-0 z-[-1] flex justify-center items-center flex-col gap-2">
                <LoaderCircle className="animate-spin" />
                {showText && <p className="text-muted-foreground">Die Konferenz ist möglicherweise nicht mehr verfügbar.</p>}
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:grid lg:grid-cols-[3fr_1fr] lg:grid-rows-[min-content_1fr] h-screen w-screen fixed top-0 left-0 z-[-1] overflow-hidden">
            <div className="h-13"></div>
            <div></div>

            {/* Toolbar für mobile Geräte */}
            <div className="lg:hidden flex items-center justify-between gap-2 p-2 border-b bg-background/95 backdrop-blur-sm z-40">
                <div className="flex items-center gap-2">
                    <Button asChild variant="ghost" size="sm">
                        <Link href="/app" className="flex items-center gap-1.5">
                            <ArrowLeft className="w-4 h-4" />
                            <span>Verlassen</span>
                        </Link>
                    </Button>
                    <ParticipantsSheet
                        webrtcParticipants={webrtcParticipants}
                        derivedRole={derivedRole}
                        organizer={organizer}
                        currentPresenter={currentPresenter}
                        conference={conference}
                        userById={userById}
                        currentParticipants={currentParticipants}
                        currentViewers={currentViewers}
                        selectedUserIds={selectedUserIds}
                        setSelectedUserIds={setSelectedUserIds}
                        inviteQuery={inviteQuery}
                        setInviteQuery={setInviteQuery}
                        visibleUsers={visibleUsers}
                        remainingSlots={remainingSlots}
                        atLimit={atLimit}
                        toggleUser={toggleUser}
                        handleInviteSubmit={handleInviteSubmit}
                        handleRemoveParticipant={handleRemoveParticipant}
                        handleSetPresenter={handleSetPresenter}
                        handleActivateQuestioner={handleActivateQuestioner}
                        handleDeactivateQuestioner={handleDeactivateQuestioner}
                        trigger={
                            <Button size="sm" variant="outline">
                                <Users className="w-4 h-4 mr-1" />
                                <span className="hidden sm:inline">Teilnehmer ({webrtcParticipants.length})</span>
                                <span className="sm:hidden">{webrtcParticipants.length}</span>
                            </Button>
                        }
                    />
                </div>
                <ConferenceInfoSheet
                    conference={conference}
                    organizer={organizer}
                    currentParticipants={currentParticipants}
                    link={link}
                />
            </div>

            <div className="m-2 lg:ml-2 lg:my-2 border rounded-xl relative h-full lg:h-auto bg-gradient-to-br from-background via-background to-muted/5 overflow-hidden shadow-inner flex-1 min-h-0">
                {disabled ? (
                    <div className="h-full justify-center items-center flex flex-col gap-4 p-8">
                        <div className="text-5xl mb-2">🔴</div>
                        <div className="font-semibold text-2xl">Konferenz beendet</div>
                        <div className="text-muted-foreground text-center max-w-md">Sie können die Konferenz verlassen oder den Chatverlauf sowie die Konferenzinformationen einsehen</div>
                    </div>
                ) : (
                    <>
                        {derivedRole === "VIEWER" ? (
                            <HLSViewer 
                                conferenceId={conference.id} 
                                currentPresenter={currentPresenter}
                                organizerId={conference.organizerId}
                                hasQuestioner={conference.participants.some((p: UserConference & { isPresenter?: boolean }) => (p.role as ExtendedRole) === "QUESTIONER")}
                            />
                        ) : (
                            <ConferenceVideoLayout
                                localStream={localStream}
                                participantStreams={participantStreams}
                                activeScreenShare={activeScreenShare}
                                isScreenSharing={isScreenSharing}
                                localScreenStream={localScreenStream}
                                startScreenShare={startScreenShare}
                                stopScreenShare={stopScreenShare}
                                currentPresenter={currentPresenter}
                                derivedRole={derivedRole}
                                isCurrentUserPresenter={isCurrentUserPresenter}
                                conference={conference}
                                getUserName={getUserName}
                            />
                        )}
                    </>
                )}

                {/* Desktop Buttons - nur auf größeren Bildschirmen sichtbar */}
                <div className="hidden lg:flex absolute bottom-4 left-4 gap-3 flex-wrap z-30">
                    <Button asChild variant="outline" className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background border-2">
                        <Link href="/app" className="flex items-center gap-2">
                            <ArrowLeft className="w-4 h-4" />
                            Verlassen
                        </Link>
                    </Button>
                    
                    <ParticipantsSheet
                        webrtcParticipants={webrtcParticipants}
                        derivedRole={derivedRole}
                        organizer={organizer}
                        currentPresenter={currentPresenter}
                        conference={conference}
                        userById={userById}
                        currentParticipants={currentParticipants}
                        currentViewers={currentViewers}
                        selectedUserIds={selectedUserIds}
                        setSelectedUserIds={setSelectedUserIds}
                        inviteQuery={inviteQuery}
                        setInviteQuery={setInviteQuery}
                        visibleUsers={visibleUsers}
                        remainingSlots={remainingSlots}
                        atLimit={atLimit}
                        toggleUser={toggleUser}
                        handleInviteSubmit={handleInviteSubmit}
                        handleRemoveParticipant={handleRemoveParticipant}
                        handleSetPresenter={handleSetPresenter}
                        handleActivateQuestioner={handleActivateQuestioner}
                        handleDeactivateQuestioner={handleDeactivateQuestioner}
                    />

                    <ConferenceInfoSheet
                        conference={conference}
                        organizer={organizer}
                        currentParticipants={currentParticipants}
                        link={link}
                        trigger={
                            <Button 
                                size="icon" 
                                variant="outline" 
                                className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background border-2"
                            >
                                <Info className="w-4 h-4" />
                            </Button>
                        }
                    />
                </div>
            </div>

            {/* Chat - auf mobil als Sheet, auf Desktop als Sidebar */}
            <div className="hidden m-2 lg:mr-2 lg:my-2 border rounded-xl overflow-hidden bg-gradient-to-br from-background via-background to-muted/5 shadow-inner lg:flex flex-col min-h-0">
                <ConferenceChat conference={conference} disabled={disabled} />
            </div>

            {/* Mobile Chat Sheet */}
            <Sheet>
                <SheetTrigger asChild>
                    <Button 
                        className="lg:hidden fixed bottom-4 right-4 rounded-full w-14 h-14 shadow-2xl z-50 bg-primary hover:bg-primary/90"
                        size="icon"
                    >
                        <MessageCircle className="w-6 h-6 text-primary-foreground" />
                    </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[70vh] p-0">
                    <SheetHeader className="px-4 pt-4 pb-2 border-b">
                        <SheetTitle>Chat</SheetTitle>
                    </SheetHeader>
                    <div className="h-[calc(70vh-4rem)] overflow-hidden">
                        <ConferenceChat conference={conference} disabled={disabled} />
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
