"use client";

import { User } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Crown, Monitor, MonitorOff } from "lucide-react";
import { VideoTile } from "./VideoTile";
import { ExtendedRole, ConferenceWithParticipants } from "@/lib/ConferenceTypes";

interface ConferenceVideoLayoutProps {
    localStream: MediaStream | null;
    participantStreams: Record<string, MediaStream>;
    activeScreenShare: { userId: string; stream: MediaStream; userName: string } | null;
    isScreenSharing: boolean;
    localScreenStream: MediaStream | null;
    startScreenShare: () => Promise<void>;
    stopScreenShare: () => void;
    currentPresenter: User | null;
    derivedRole: ExtendedRole;
    isCurrentUserPresenter: boolean;
    conference: ConferenceWithParticipants;
    getUserName: (peerId: string) => string;
}

export function ConferenceVideoLayout({
                                          localStream,
                                          participantStreams,
                                          activeScreenShare,
                                          isScreenSharing,
                                          localScreenStream,
                                          startScreenShare,
                                          stopScreenShare,
                                          currentPresenter,
                                          derivedRole,
                                          isCurrentUserPresenter,
                                          conference,
                                          getUserName,
                                      }: ConferenceVideoLayoutProps) {
    const participantEntries = Object.entries(participantStreams);
    const participantCount = participantEntries.length;
    const hasLocal = !!localStream;
    const totalParticipants = participantCount + (hasLocal ? 1 : 0);

    // ✅ Einziger ScreenShare-Quelle der Wahrheit:
    // - wenn jemand anders teilt: activeScreenShare
    // - wenn du teilst: localScreenStream (nur wenn isScreenSharing)
    const screenTile = activeScreenShare
        ? {
            stream: activeScreenShare.stream,
            title: `${activeScreenShare.userName} teilt Bildschirm`,
            isLocal: false,
        }
        : isScreenSharing && localScreenStream
            ? {
                stream: localScreenStream,
                title: "Du teilst Bildschirm",
                isLocal: true,
            }
            : null;

    const hasScreenShare = !!screenTile;

    const localTitle = isCurrentUserPresenter
        ? "Du (Präsentator)"
        : derivedRole === "ORGANIZER"
            ? "Du (Organizer)"
            : derivedRole === "QUESTIONER"
                ? "Du (Fragesteller)"
                : "Du";

    return (
        <div className="h-full relative flex flex-col p-2 sm:p-3 md:p-4 gap-3 sm:gap-4">
            {currentPresenter && (
                <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 bg-muted/30 rounded-lg mb-2">
                    <Crown className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm font-medium">
            Präsentator: {currentPresenter.firstName} {currentPresenter.lastName ?? ""}
          </span>
                </div>
            )}

            {/* ✅ ScreenShare-Layout: immer gleich (egal wer teilt) */}
            {hasScreenShare ? (
                <>
                    {/* Kamera-Leiste oben */}
                    <div className="flex-shrink-0 h-32 sm:h-40">
                        {totalParticipants === 0 ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-center text-muted-foreground">
                                    <div className="text-2xl mb-2">📹</div>
                                    <div className="text-sm">Warte auf Teilnehmer...</div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex gap-2 sm:gap-3 overflow-x-auto pb-2">
                                {hasLocal && (
                                    <div className="flex-shrink-0 w-48 sm:w-56 md:w-64">
                                        <VideoTile
                                            stream={localStream}
                                            title={localTitle}
                                            mutedByDefault={true}
                                            mirror={true}
                                            isLocal={true}
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                )}

                                {participantEntries.map(([peerId, stream]) => {
                                    const peerUC = conference?.participants.find((p) => p.userId === peerId);
                                    const isPeerPresenter = peerUC?.isPresenter ?? false;
                                    const isPeerQuestioner = (peerUC?.role as ExtendedRole | undefined) === "QUESTIONER";

                                    let title = getUserName(peerId);
                                    if (isPeerPresenter) title += " (Präsentator)";
                                    if (isPeerQuestioner) title += " (Fragesteller)";

                                    // Wenn dieser Peer gerade den Screen teilt, ist dieses Tile seine Kamera
                                    const isSharerCamera = activeScreenShare && activeScreenShare.userId === peerId;
                                    if (isSharerCamera) title += " (Kamera)";

                                    return (
                                        <div key={peerId} className="flex-shrink-0 w-48 sm:w-56 md:w-64">
                                            <VideoTile
                                                stream={stream}
                                                title={title}
                                                mirror={false}
                                                mutedByDefault={false}
                                                isLocal={false}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Screen unten groß */}
                    <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden bg-black">
                        {screenTile && (
                            <VideoTile
                                stream={screenTile.stream}
                                title={screenTile.title}
                                mirror={false}
                                mutedByDefault={screenTile.isLocal}
                                isLocal={screenTile.isLocal}
                                className="w-full h-full object-contain"
                            />
                        )}

                        {(derivedRole === "ORGANIZER" || derivedRole === "PARTICIPANT") && (
                            <div className="absolute top-4 right-4 z-30">
                                <Button
                                    onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                                    variant="outline"
                                    size="sm"
                                    className="shadow-lg backdrop-blur-sm bg-background/95 hover:bg-background"
                                >
                                    {isScreenSharing ? (
                                        <>
                                            <MonitorOff className="w-4 h-4 mr-2" />
                                            <span className="hidden sm:inline">Teilen beenden</span>
                                            <span className="sm:hidden">Beenden</span>
                                        </>
                                    ) : (
                                        <>
                                            <Monitor className="w-4 h-4 mr-2" />
                                            <span className="hidden sm:inline">Bildschirm teilen</span>
                                            <span className="sm:hidden">Teilen</span>
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <>
                    {/* ✅ Kein ScreenShare: dein bisheriges Grid unverändert */}
                    {totalParticipants === 0 ? (
                        <div className="flex-1 min-h-0 flex items-center justify-center">
                            <div className="text-center text-muted-foreground">
                                <div className="text-4xl mb-4">📹</div>
                                <div className="text-lg font-medium mb-2">Warte auf Teilnehmer...</div>
                                <div className="text-sm">Sobald andere Teilnehmer beitreten, werden sie hier angezeigt.</div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0">
                            {totalParticipants === 1 ? (
                                <div className="h-full flex items-center justify-center">
                                    {hasLocal && (
                                        <div className="w-full max-w-2xl">
                                            <VideoTile
                                                stream={localStream}
                                                title={localTitle}
                                                mutedByDefault={true}
                                                mirror={true}
                                                isLocal={true}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    )}
                                </div>
                            ) : totalParticipants <= 4 ? (
                                <div
                                    className={`h-full grid grid-cols-1 sm:grid-cols-2 ${
                                        totalParticipants === 2 ? "gap-0" : "gap-3 sm:gap-4"
                                    }`}
                                >
                                    {hasLocal && (
                                        <VideoTile
                                            stream={localStream}
                                            title={localTitle}
                                            mutedByDefault={true}
                                            mirror={true}
                                            isLocal={true}
                                            noBorder={totalParticipants === 2}
                                            className="w-full h-full object-cover"
                                        />
                                    )}

                                    {participantEntries.map(([peerId, stream]) => {
                                        const peerUC = conference?.participants.find((p) => p.userId === peerId);
                                        const isPeerPresenter = peerUC?.isPresenter ?? false;
                                        const isPeerQuestioner = (peerUC?.role as ExtendedRole | undefined) === "QUESTIONER";

                                        let title = getUserName(peerId);
                                        if (isPeerPresenter) title += " (Präsentator)";
                                        if (isPeerQuestioner) title += " (Fragesteller)";

                                        return (
                                            <VideoTile
                                                key={peerId}
                                                stream={stream}
                                                title={title}
                                                mirror={false}
                                                mutedByDefault={false}
                                                isLocal={false}
                                                noBorder={totalParticipants === 2}
                                                className="w-full h-full object-cover"
                                            />
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="h-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                                    {hasLocal && (
                                        <VideoTile
                                            stream={localStream}
                                            title={localTitle}
                                            mutedByDefault={true}
                                            mirror={true}
                                            isLocal={true}
                                            className="w-full aspect-video object-cover"
                                        />
                                    )}

                                    {participantEntries.map(([peerId, stream]) => {
                                        const peerUC = conference?.participants.find((p) => p.userId === peerId);
                                        const isPeerPresenter = peerUC?.isPresenter ?? false;
                                        const isPeerQuestioner = (peerUC?.role as ExtendedRole | undefined) === "QUESTIONER";

                                        let title = getUserName(peerId);
                                        if (isPeerPresenter) title += " (Präsentator)";
                                        if (isPeerQuestioner) title += " (Fragesteller)";

                                        return (
                                            <VideoTile
                                                key={peerId}
                                                stream={stream}
                                                title={title}
                                                mirror={false}
                                                mutedByDefault={false}
                                                isLocal={false}
                                                className="w-full aspect-video object-cover"
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {totalParticipants > 0 && (derivedRole === "PARTICIPANT" || isCurrentUserPresenter) && (
                        <div className="flex-shrink-0 flex justify-center pt-2">
                            <Button onClick={startScreenShare} variant="outline" size="lg" className="shadow-lg">
                                <Monitor className="w-5 h-5 mr-2" />
                                Bildschirm teilen
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
