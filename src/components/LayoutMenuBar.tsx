"use client";

import {
    Menubar,
    MenubarContent,
    MenubarItem,
    MenubarMenu,
    MenubarSeparator,
    MenubarTrigger,
} from "@/components/ui/menubar";
import React, {useCallback, useEffect, useRef} from "react";
import Link from "next/link";
import NewConferenceDialog from "@/components/NewConferenceDialog";
import {useRouter} from "next/navigation";
import {useWS} from "@/context/WebSocketContext";
import {useAuth} from "@/context/AuthContext";
import {toast} from "sonner";
import {SettingsDialog} from "@/components/SettingsDialog";

export default function LayoutMenuBar({logoutAction}: { logoutAction: () => void }) {
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
    const router = useRouter();
    const { user } = useAuth();
    const ws = useWS()

    const userIdRef = useRef<string | null>(null);
    useEffect(() => {
        userIdRef.current = user?.id ?? null;
    }, [user?.id]);

    const onParticipantsAdded = useCallback((msg: unknown) => {
        const { conferenceId, userIds, link, title } = (msg as {
            title: string;
            conferenceId: string;
            userIds: string[];
            link: string;
        });

        const myId = userIdRef.current;
        if (myId && userIds.includes(myId)) {
            toast("Du wurdest zu einer Konferenz hinzugefügt", {
                id: `added-${conferenceId}`, // verhindert Duplikate
                description: `Konferenz: ${title}`,
                action: {
                    label: "Zur Konferenz",
                    onClick: () => router.push(`/app/${link}`),
                },
            });
        }
    }, [router]);

    useEffect(() => {
        if (!ws) return;
        ws.on("server:ConferenceParticipantsAdded", onParticipantsAdded);
    }, [ws, onParticipantsAdded]);

    const handleReload = () => {
        console.log("Neu laden triggered!");
    };

    const handleForceReload = () => {
        window.location.reload();
    };

    return (
        <>
            <Menubar className="m-2">
                <MenubarMenu>
                    <MenubarTrigger>Konferenz</MenubarTrigger>
                    <MenubarContent>
                        <MenubarItem asChild>
                            <Link href="/app">
                                Alle Konferenzen
                            </Link>
                        </MenubarItem>
                        <MenubarSeparator/>
                        <MenubarItem onSelect={() => setIsDialogOpen(true)}>
                            Konferenz erstellen
                        </MenubarItem>
                    </MenubarContent>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Ansicht</MenubarTrigger>
                    <MenubarContent>
                        <MenubarItem onSelect={handleReload}>
                            Neu laden
                        </MenubarItem>
                        <MenubarItem onSelect={handleForceReload}>
                            Erzwinge Neu laden
                        </MenubarItem>
                        <MenubarSeparator/>
                        <MenubarItem>Vollbild umschalten</MenubarItem>
                    </MenubarContent>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Account</MenubarTrigger>
                    <MenubarContent>
                        <MenubarItem onSelect={() => setIsSettingsOpen(true)}>
                            Profil
                        </MenubarItem>
                        <MenubarSeparator/>
                        <MenubarItem variant="destructive" onSelect={logoutAction}>Abmelden</MenubarItem>
                    </MenubarContent>
                </MenubarMenu>
            </Menubar>
            <NewConferenceDialog open={isDialogOpen} setOpen={setIsDialogOpen}/>
            <SettingsDialog open={isSettingsOpen} setOpen={setIsSettingsOpen}/>
        </>
    );
}