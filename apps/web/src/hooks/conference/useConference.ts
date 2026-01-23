"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {User, UserConference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import {useWS} from "@/context/WebSocketContext";
import {ConferenceWithParticipants, ExtendedRole, UserLite} from "@/lib/ConferenceTypes";

export function useConference(link: string) {
    const [disabled, setDisabled] = useState(false);
    const [conference, setConference] = useState<ConferenceWithParticipants | null>(null);
    const [organizer, setOrganizer] = useState<User | null>(null);
    const [userById, setUserById] = useState<Record<string, UserLite>>({});
    const [presence, setPresence] = useState<{ viewers: string[]; participants: string[] }>({
        viewers: [],
        participants: [],
    });

    const { fetchWithAuth, user } = useAuth();
    const ws = useWS();
    const lastInitRef = useRef<string | null>(null);

    const fetchConference = useCallback(async () => {
        try {
            const res = await fetchWithAuth<ConferenceWithParticipants>(`/api/conference/${link}`);
            if (res.status === "ENDED") setDisabled(true);
            setConference(res);
        } catch (err) {
            console.error(err);
        }
    }, [fetchWithAuth, link]);

    useEffect(() => {
        fetchConference();
        const off1 = ws.on("server:ConferenceParticipantsAdded", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off2 = ws.on("server:ConferenceParticipantsRemoved", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off3 = ws.on("server:PresenterChanged", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off4 = ws.on("server:QuestionerActivated", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        const off5 = ws.on("server:QuestionerDeactivated", (msg: unknown) => {
            const m = msg as { conferenceId?: string };
            if (m?.conferenceId && m.conferenceId === conference?.id) {
                fetchConference();
            }
        });
        return () => {
            off1();
            off2();
            off3();
            off4();
            off5();
        };
    }, [ws, conference?.id, fetchConference]);

    useEffect(() => {
        return ws.on("server:presence-update", (msg: unknown) => {
            const m = msg as { conferenceId?: string; viewers?: string[]; participants?: string[] };
            if (!m?.conferenceId || m.conferenceId !== conference?.id) return;

            setPresence({
                viewers: m.viewers ?? [],
                participants: m.participants ?? [],
            });
        });
    }, [ws, conference?.id]);

    const neededUserIds = useMemo(() => {
        const ids = new Set<string>();
        if (conference?.organizerId) ids.add(conference.organizerId);
        conference?.participants.forEach(p => ids.add(p.userId));
        presence.viewers.forEach(id => ids.add(id));
        presence.participants.forEach(id => ids.add(id));
        return Array.from(ids);
    }, [conference, presence]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (neededUserIds.length === 0) return;

            const users = await fetchWithAuth<UserLite[]>("/api/user/batch", {
                method: "POST",
                body: JSON.stringify({ ids: neededUserIds }),
            });

            if (cancelled) return;

            setUserById(prev => {
                const next = { ...prev };
                for (const u of users) next[u.id] = u;
                return next;
            });
        })().catch(console.error);

        return () => { cancelled = true; };
    }, [fetchWithAuth, neededUserIds]);

    useEffect(() => {
        if (!conference) {
            setOrganizer(null);
            return;
        }
        const org = userById[conference.organizerId];
        setOrganizer(org ? { ...org, email: "" } as User : null);
    }, [conference?.organizerId, userById, conference]);

    const derivedRole: ExtendedRole = useMemo(() => {
        if (!conference || !user?.id) return "VIEWER";
        if (conference.organizerId === user.id) return "ORGANIZER";
        const uc = conference.participants.find((p: UserConference & { isPresenter?: boolean }) => p.userId === user.id);
        if (!uc) return "VIEWER";
        return uc.role as ExtendedRole;
    }, [conference, user?.id]);

    const currentPresenter = useMemo(() => {
        if (!conference) return null;
        const presenter = conference.participants.find(p => p.isPresenter);
        if (!presenter) return null;
        const user = userById[presenter.userId];
        return user ? { ...user, email: "" } as User : null;
    }, [conference, userById]);

    const isCurrentUserPresenter = useMemo(() => {
        if (!conference || !user?.id) return false;
        const uc = conference.participants.find(p => p.userId === user.id);
        return uc?.isPresenter ?? false;
    }, [conference, user?.id]);

    useEffect(() => {
        if (ws.status === "open" && ws.reconnectCount > 0) {
            lastInitRef.current = null;
        }
    }, [ws.status, ws.reconnectCount]);

    useEffect(() => {
        if (!user?.id || !conference?.id) return;

        const inConference = derivedRole !== "VIEWER";

        const payloadKey = JSON.stringify({
            userId: user.id,
            conferenceId: conference.id,
            inConference,
        });

        if(lastInitRef.current === payloadKey)
            return;

        ws.send({ type: "init", userId: user.id, inConference, conferenceId: conference.id });
        lastInitRef.current = payloadKey;
    }, [ws, user?.id, conference?.id, derivedRole]);

    return {
        conference,
        disabled,
        organizer,
        userById,
        presence,
        derivedRole,
        currentPresenter,
        isCurrentUserPresenter,
        fetchConference,
        lastInitRef,
    };
}
