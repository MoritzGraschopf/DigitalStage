"use client"

import {useState} from "react";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";

export default function Page() {
    const [joined, setJoined] = useState(false)

    return joined ? (
        <div>joined</div>
    ) : (
        <div className="h-full grid place-items-center">
            <Tabs>
                <TabsList defaultValue="viewer">
                    <TabsTrigger value="viewer">Zuschauer</TabsTrigger>
                    <TabsTrigger value="participant">Teilnehmer</TabsTrigger>
                </TabsList>
                <TabsContent value="viewer">
                    <Card>
                        <CardHeader>
                            <CardTitle>Zuschauer</CardTitle>
                            <CardDescription>Als Zuschauer Beitreten</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button className="w-full" asChild>
                                Beitreten
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}