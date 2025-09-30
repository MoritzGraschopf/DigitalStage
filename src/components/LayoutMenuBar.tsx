"use client";

import {
    Menubar,
    MenubarContent,
    MenubarItem,
    MenubarMenu,
    MenubarSeparator,
    MenubarTrigger,
} from "@/components/ui/menubar";
import React from "react";
import Link from "next/link";
import NewConferenceDialog from "@/components/NewConferenceDialog";

export default function LayoutMenuBar({logout}: { logout: () => void }) {
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);

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
                        <MenubarItem>
                            <Link href="/app/account">
                                Profil
                            </Link>
                        </MenubarItem>
                        <MenubarSeparator/>
                        <MenubarItem variant="destructive" onSelect={logout}>Abmelden</MenubarItem>
                    </MenubarContent>
                </MenubarMenu>
            </Menubar>
            <NewConferenceDialog open={isDialogOpen} setOpen={setIsDialogOpen}/>
        </>
    );
}