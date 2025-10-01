"use client"

import React from "react";
import {Separator} from "@/components/ui/separator";
import {useAuth} from "@/context/AuthContext";

const GenerelPage: React.FC = () => {
    const { user } = useAuth();

    return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Allgemein</h1>

            <Separator className="my-2"/>

            <div className="flex justify-between">
                <div>Vorname:</div>
                <div>{user?.firstName}</div>
            </div>
            <div className="flex justify-between">
                <div>Nachname:</div>
                <div>{user?.lastName}</div>
            </div>
        </div>
    )
}

export default GenerelPage