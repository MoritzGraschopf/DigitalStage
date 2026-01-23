"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { User } from "@prisma/client";
import { useAuth } from "@/context/AuthContext";
import { useWS } from "@/context/WebSocketContext";
import { ConferenceWithParticipants, ExtendedRole, UserLite } from "@/lib/ConferenceTypes";

export function useConferenceParticipants(
    conference: ConferenceWithParticipants | null,
    userById: Record<string, UserLite>,
    presence: { viewers: string[]; participants: string[] },
    fetchConference: () => Promise<void>
) {
    const { fetchWithAuth, user } = useAuth();
    const ws = useWS();
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [inviteQuery, setInviteQuery] = useState("");
    const [inviteResults, setInviteResults] = useState<UserLite[]>([]);

    useEffect(() => {
        const q = inviteQuery.trim();
        const t = setTimeout(async () => {
            if (q.length < 2) { 
                setInviteResults([]); 
                return; 
            }
            try {
                const res = await fetchWithAuth<UserLite[]>(`/api/user/search?q=${encodeURIComponent(q)}`);
                setInviteResults(res);
            } catch (err) {
                console.error("Error searching users:", err);
                setInviteResults([]);
            }
        }, 250);

        return () => clearTimeout(t);
    }, [inviteQuery, fetchWithAuth]);

    const visibleUsers = useMemo(
        () => inviteResults.filter(u => (user ? u.id !== user.id : true)),
        [inviteResults, user]
    );

    const currentParticipants = useMemo(() => {
        if (!conference) return [] as User[];
        const parts = conference.participants.filter(p => {
            const role = p.role as ExtendedRole;
            return (role === "PARTICIPANT" || role === "QUESTIONER") && p.userId !== conference.organizerId;
        });
        return parts
            .map(p => userById[p.userId])
            .filter((u): u is UserLite => !!u)
            .map(u => ({ ...u, email: "" } as User));
    }, [conference, userById]);

    const currentViewers = useMemo((): UserLite[] => {
        return presence.viewers
            .map(id => userById[id])
            .filter((u): u is UserLite => !!u);
    }, [presence.viewers, userById]);

    const maxTotal = 10;
    const currentCount = currentParticipants.length;
    const remainingSlots = Math.max(0, maxTotal - currentCount);
    const atLimit = selectedUserIds.length >= remainingSlots && remainingSlots > 0;

    const toggleUser = useCallback((id: string) => {
        if (user && id === user.id) return;
        setSelectedUserIds(prev => {
            const isSelected = prev.includes(id);
            if (isSelected) return prev.filter(x => x !== id);
            if (remainingSlots <= 0) return prev;
            if (prev.length >= remainingSlots) return prev;
            const already = currentParticipants.some(p => p.id === id);
            if (already)
                return prev;
            return [...prev, id];
        });
    }, [user, remainingSlots, currentParticipants]);

    const handleInviteSubmit = useCallback(async () => {
        try {
            if (!conference || selectedUserIds.length === 0) return;

            await fetchWithAuth(`/api/conference/${conference.link}/participants`, {
                method: "POST",
                body: JSON.stringify({ userIds: selectedUserIds }),
            });
            ws.send({ type: "ConferenceParticipantsAdded", conferenceId: conference.id, userIds: selectedUserIds, link: conference.link });
            setSelectedUserIds([]);
            fetchConference();
        } catch (e) {
            console.error("Teilnehmer hinzufügen fehlgeschlagen:", e);
        }
    }, [conference, selectedUserIds, fetchWithAuth, ws, fetchConference]);

    const handleRemoveParticipant = useCallback(async (userId: string) => {
        try {
            if (!conference) return;
            await fetchWithAuth(`/api/conference/${conference.link}/participants/${userId}`, {
                method: "DELETE",
            });
            ws.send({ type: "ConferenceParticipantsRemoved", conferenceId: conference.id, userIds: [userId], link: conference.link });
            fetchConference();
        } catch (e) {
            console.error("Teilnehmer entfernen fehlgeschlagen:", e);
        }
    }, [conference, fetchWithAuth, ws, fetchConference]);

    const handleSetPresenter = useCallback(async (userId: string | null) => {
        try {
            if (!conference) return;
            if (userId) {
                await fetchWithAuth(`/api/conference/${conference.link}/presenter`, {
                    method: "POST",
                    body: JSON.stringify({ userId }),
                });
                ws.send({ 
                    type: "PresenterChanged", 
                    conferenceId: conference.id, 
                    presenterUserId: userId, 
                    link: conference.link 
                });
            } else {
                await fetchWithAuth(`/api/conference/${conference.link}/presenter`, {
                    method: "DELETE",
                });
                ws.send({ 
                    type: "PresenterChanged", 
                    conferenceId: conference.id, 
                    presenterUserId: null, 
                    link: conference.link 
                });
            }
            fetchConference();
        } catch (e) {
            console.error("Präsentator setzen fehlgeschlagen:", e);
            alert(`Fehler: ${e instanceof Error ? e.message : "Unbekannter Fehler"}`);
        }
    }, [conference, fetchWithAuth, ws, fetchConference]);

    const handleActivateQuestioner = useCallback(async (userId: string) => {
        try {
            if (!conference) return;
            await fetchWithAuth(`/api/conference/${conference.link}/questioner/${userId}`, {
                method: "POST",
            });
            ws.send({ 
                type: "QuestionerActivated", 
                conferenceId: conference.id, 
                userId, 
                link: conference.link 
            });
            fetchConference();
        } catch (e) {
            console.error("Fragesteller aktivieren fehlgeschlagen:", e);
        }
    }, [conference, fetchWithAuth, ws, fetchConference]);

    const handleDeactivateQuestioner = useCallback(async (userId: string) => {
        try {
            if (!conference) return;
            await fetchWithAuth(`/api/conference/${conference.link}/questioner/${userId}`, {
                method: "DELETE",
            });
            ws.send({ 
                type: "QuestionerDeactivated", 
                conferenceId: conference.id, 
                userId, 
                link: conference.link 
            });
            fetchConference();
        } catch (e) {
            console.error("Fragesteller deaktivieren fehlgeschlagen:", e);
            alert(`Fehler: ${e instanceof Error ? e.message : "Unbekannter Fehler"}`);
        }
    }, [conference, fetchWithAuth, ws, fetchConference]);

    return {
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
    };
}
