"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ConferenceWithParticipants, ExtendedRole, UserLite } from "@/lib/ConferenceTypes";

export function useConferenceStreams(
    localStream: MediaStream | null,
    remoteStreams: Record<string, MediaStream>, // unterstützt "userId:camera" / "userId:screen" ODER legacy "userId"
    isScreenSharing: boolean,
    localScreenStream: MediaStream | null,
    audioMuteStatus: Record<string, boolean>,
    user: { id: string; firstName: string; lastName?: string | null } | null,
    conference: ConferenceWithParticipants | null,
    userById: Record<string, UserLite>,
    derivedRole: ExtendedRole,
    isCurrentUserPresenter: boolean
) {
    const prevIsPresenterRef = useRef(isCurrentUserPresenter);
    const prevScreenSharingRef = useRef(isScreenSharing);

    useEffect(() => {
        if (prevIsPresenterRef.current && !isCurrentUserPresenter && isScreenSharing) {
            console.log("User ist nicht mehr Präsentator -> Screenshare stoppen");
        }
        prevIsPresenterRef.current = isCurrentUserPresenter;
    }, [isCurrentUserPresenter, isScreenSharing]);

    useEffect(() => {
        if (prevScreenSharingRef.current && !isScreenSharing) {
            console.log("Screenshare beendet -> prüfe ob Update nötig");
            const timer = setTimeout(() => {}, 100);
            return () => clearTimeout(timer);
        }
        prevScreenSharingRef.current = isScreenSharing;
    }, [isScreenSharing]);

    const getUserName = useCallback(
        (peerId: string): string => {
            const u = userById[peerId];
            return u ? `${u.firstName}${u.lastName ? ` ${u.lastName}` : ""}` : peerId;
        },
        [userById]
    );

    const { participantStreams, screenShareStreams } = useMemo(() => {
        const participants: Record<string, MediaStream> = {};
        const screens: Record<string, MediaStream> = {};

        const isTypedKey = (key: string) => key.includes(":");
        const parseKey = (key: string): { userId: string; kind: "camera" | "screen" | "unknown" } => {
            if (!isTypedKey(key)) return { userId: key, kind: "unknown" };
            const [userId, kindRaw] = key.split(":");
            const kind = kindRaw === "camera" || kindRaw === "screen" ? kindRaw : "unknown";
            return { userId, kind };
        };

        Object.entries(remoteStreams).forEach(([key, stream]) => {
            const { userId, kind } = parseKey(key);

            // ✅ NEU: wenn du remoteStreams als "userId:camera"/"userId:screen" führst
            if (kind === "camera") {
                participants[userId] = stream;
                return;
            }
            if (kind === "screen") {
                screens[userId] = stream;
                return;
            }

            // ♻️ LEGACY/Fallback: alter Aufbau (nur "userId") -> splitte nach Tracks
            const videoTracks = stream.getVideoTracks();
            const audioTracks = stream.getAudioTracks();

            const cameraTracks: MediaStreamTrack[] = [];
            const screenTracks: MediaStreamTrack[] = [];

            videoTracks.forEach((track) => {
                const label = (track.label || "").toLowerCase();
                if (
                    label.includes("screen") ||
                    label.includes("display") ||
                    label.includes("window") ||
                    label.includes("monitor")
                ) {
                    screenTracks.push(track);
                } else {
                    cameraTracks.push(track);
                }
            });

            // Kamera-Stream (mit Audio wenn vorhanden)
            if (cameraTracks.length > 0) {
                participants[userId] = new MediaStream([...cameraTracks, ...audioTracks]);
            } else if (audioTracks.length > 0) {
                // nur Audio (falls keine Kamera)
                participants[userId] = new MediaStream([...audioTracks]);
            }

            // Screen-Stream (nur Video reicht)
            if (screenTracks.length > 0) {
                screens[userId] = new MediaStream([...screenTracks]);
            }
        });

        return { participantStreams: participants, screenShareStreams: screens };
    }, [remoteStreams]);

    const activeScreenShare = useMemo(() => {
        // local first (damit es für dich genauso aussieht wie für andere)
        if (isScreenSharing && localScreenStream) {
            return { userId: user?.id ?? "", stream: localScreenStream, userName: "Du" };
        }

        // sonst irgendein remote screen (du kannst hier auch "presenter first" machen, wenn du willst)
        const entries = Object.entries(screenShareStreams);
        if (entries.length > 0) {
            const [userId, stream] = entries[0];
            return { userId, stream, userName: getUserName(userId) };
        }

        return null;
    }, [screenShareStreams, getUserName, isScreenSharing, localScreenStream, user?.id]);

    const webrtcParticipants = useMemo(() => {
        const participants: Array<{
            userId: string;
            name: string;
            role: ExtendedRole;
            isPresenter: boolean;
            isQuestioner: boolean;
            isMuted: boolean;
            isLocal: boolean;
        }> = [];

        if (localStream && user) {
            const uc = conference?.participants.find((p) => p.userId === user.id);
            const role = uc?.role as ExtendedRole | undefined;
            const isPresenter = uc?.isPresenter ?? false;

            participants.push({
                userId: user.id,
                name: `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`,
                role: derivedRole,
                isPresenter,
                isQuestioner: !isPresenter && role === "QUESTIONER",
                isMuted: audioMuteStatus[user.id] ?? true,
                isLocal: true,
            });
        }

        Object.keys(participantStreams).forEach((userId) => {
            const uc = conference?.participants.find((p) => p.userId === userId);
            const role = uc?.role as ExtendedRole | undefined;
            const u = userById[userId];
            if (!u) return;

            const isPresenter = uc?.isPresenter ?? false;

            participants.push({
                userId,
                name: `${u.firstName}${u.lastName ? ` ${u.lastName}` : ""}`,
                role: role ?? "PARTICIPANT",
                isPresenter,
                isQuestioner: !isPresenter && role === "QUESTIONER",
                isMuted: audioMuteStatus[userId] ?? true,
                isLocal: false,
            });
        });

        return participants;
    }, [localStream, user, conference, userById, derivedRole, participantStreams, audioMuteStatus]);

    return {
        participantStreams,
        screenShareStreams,
        activeScreenShare,
        webrtcParticipants,
        getUserName,
    };
}
