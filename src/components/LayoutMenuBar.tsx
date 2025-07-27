"use client";

import {
    Menubar,
    MenubarContent,
    MenubarItem,
    MenubarMenu,
    MenubarSeparator,
    MenubarShortcut,
    MenubarTrigger,
} from "@/components/ui/menubar";
import React, {useEffect} from "react";
import Link from "next/link";

export default function LayoutMenuBar({logout}: { logout: () => void }) {
    const handleReload = () => {
        console.log("Neu laden triggered!");
    };

    const handleForceReload = () => {
        window.location.reload();
    };

    useEffect(() => {
        const handleKeyboardShortcut = (event: KeyboardEvent) => {
            // CMD + R (Neu laden)
            if (event.metaKey && event.key === "r" && !event.shiftKey) {
                event.preventDefault();
                handleReload();
            }

            // Shift + CMD + R (Erzwinge Neu laden)
            if (event.metaKey && event.key === "r" && event.shiftKey) {
                event.preventDefault();
                handleForceReload();
            }
        };

        window.addEventListener("keydown", handleKeyboardShortcut);

        // Cleanup the event listener when the component is unmounted
        return () => {
            window.removeEventListener("keydown", handleKeyboardShortcut);
        };
    }, []);

    return (
        <Menubar className="m-2">
            <MenubarMenu>
                <MenubarTrigger>Ansicht</MenubarTrigger>
                <MenubarContent>
                    <MenubarItem onSelect={handleReload}>
                        Neu laden <MenubarShortcut>⌘R</MenubarShortcut>
                    </MenubarItem>
                    <MenubarItem onSelect={handleForceReload}>
                        Erzwinge Neu laden <MenubarShortcut>⇧⌘R</MenubarShortcut>
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
                    <MenubarItem>Einstellungen</MenubarItem>
                    <MenubarSeparator/>
                    <MenubarItem variant="destructive" onSelect={logout}>Abmelden</MenubarItem>
                </MenubarContent>
            </MenubarMenu>
        </Menubar>
    );
}