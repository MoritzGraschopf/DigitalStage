"use client"

import * as React from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog"
import {Activity, Bot, Settings, Shield, User as UserIcon} from "lucide-react"
import GenerelPage from "@/components/settings/General";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";

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
        {name: "Allgemein", icon: UserIcon, page: () => <GenerelPage/>},
        {name: "Sicherheit", icon: Shield, page: () => <div className="p-6">Sicherheit</div>},
        {name: "Aktivität", icon: Activity, page: () => <div className="p-6">Aktivität</div>},
        {name: "Einstellungen", icon: Settings, page: () => <div className="p-6">Einstellungen</div>},
        {name: "Entwickler", icon: Bot, page: () => <div className="p-6">Entwickler</div>},
    ],
}

export function SettingsDialog({open, setOpen}: SettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent showCloseButton={false} className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px]">
                <DialogTitle className="sr-only">Profil</DialogTitle>
                <DialogDescription className="sr-only">Settings Page</DialogDescription>

                <Tabs defaultValue={data.nav[0]?.name ?? "Allgemein"}>
                    <TabsList className="w-full flex gap-2">
                        {data.nav.map((item) => (
                            <TabsTrigger key={item.name} value={item.name}>
                                <span><item.icon/></span>
                                <span className="ml-2 hidden md:inline">{item.name}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {data.nav.map((item) => (
                        <TabsContent key={item.name} value={item.name}>
                            <main className="flex flex-1 flex-col overflow-auto">
                                <item.page/>
                            </main>
                        </TabsContent>
                    ))}
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
