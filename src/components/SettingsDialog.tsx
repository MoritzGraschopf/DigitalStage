"use client"

import * as React from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
} from "@/components/ui/sidebar"
import { Activity, Bot, Settings, Shield, User as UserIcon } from "lucide-react"

interface SettingsDialogProps {
    open: boolean
    setOpen: (open: boolean) => void
}

type NavItem = {
    name: string
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
    page: React.FC
}

const data: { nav: NavItem[] } = {
    nav: [
        { name: "Allgemein", icon: UserIcon, page: () => <div className="p-6">Allgemein</div> },
        { name: "Sicherheit", icon: Shield, page: () => <div className="p-6">Sicherheit</div> },
        { name: "Aktivität", icon: Activity, page: () => <div className="p-6">Aktivität</div> },
        { name: "Einstellungen", icon: Settings, page: () => <div className="p-6">Einstellungen</div> },
        { name: "Entwickler", icon: Bot, page: () => <div className="p-6">Entwickler</div> },
    ],
}

export function SettingsDialog({ open, setOpen }: SettingsDialogProps) {
    const [active, setActive] = React.useState<string>(data.nav[0]?.name ?? "Allgemein")

    const ActivePage = React.useMemo(
        () => data.nav.find((n) => n.name === active)?.page ?? (() => <div className="p-6" />),
        [active]
    )

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
                <DialogTitle className="sr-only">Profil</DialogTitle>
                <DialogDescription className="sr-only">Settings Page</DialogDescription>

                <SidebarProvider className="items-start">
                    {/* Sidebar (links) */}
                    <Sidebar collapsible="none" className="hidden md:flex">
                        <SidebarContent>
                            <SidebarGroup>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {data.nav.map((item) => {
                                            const Icon = item.icon
                                            const isActive = active === item.name
                                            return (
                                                <SidebarMenuItem key={item.name}>
                                                    <SidebarMenuButton
                                                        // Kein <a/> nötig – direkt klickbarer Button
                                                        onClick={() => setActive(item.name)}
                                                        isActive={isActive}
                                                        className="justify-start gap-2"
                                                    >
                                                        <Icon className="h-4 w-4" />
                                                        <span>{item.name}</span>
                                                    </SidebarMenuButton>
                                                </SidebarMenuItem>
                                            )
                                        })}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        </SidebarContent>
                    </Sidebar>

                    {/* Content (rechts) */}
                    <main className="flex h-[480px] flex-1 flex-col overflow-auto">
                        <ActivePage />
                    </main>
                </SidebarProvider>
            </DialogContent>
        </Dialog>
    )
}
