"use client"

import React from "react";
import {Separator} from "@/components/ui/separator";
import {Label} from "@/components/ui/label";
import {Switch} from "@/components/ui/switch";
import {useSettings} from "@/hooks/useSettings";
import {LoaderCircle} from "lucide-react";

const SettingsPage: React.FC = () => {
    const { settings, isLoading, update } = useSettings();

    if (isLoading) return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Einstellungen</h1>

            <Separator className="my-2"/>

            <div className="flex items-center justify-center m-2">
                <LoaderCircle className="animate-spin"/>
            </div>
        </div>
    )

    if (!settings) return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Einstellungen</h1>

            <Separator className="my-2"/>

            <p className="text-muted-foreground text-sm italic">Keine Settings gefunden.</p>
        </div>
    )

    return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Einstellungen</h1>

            <Separator className="my-2"/>

            <div className="flex items-center justify-between">
                <Label>Konferenz Benarichtigungen</Label>
                <Switch checked={settings?.notifyConfCreated} onCheckedChange={(v)=>update({ notifyConfCreated: v })} />
            </div>
        </div>
    )
}

export default SettingsPage