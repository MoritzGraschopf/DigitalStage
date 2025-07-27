"use client"

import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {use, useEffect, useState} from "react";
import {useForm} from "react-hook-form"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {z} from "zod"
import {zodResolver} from "@hookform/resolvers/zod";
import {Input} from "@/components/ui/input";
import {ArrowLeft, LoaderCircle} from "lucide-react";
import ConferenceChat from "@/components/ConferenceChat";
import {Conference} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import Link from "next/link";

const participantSchema = z.object({
    password: z.string().min(8, {
        error: "Passwort muss mindestens 8 Zeichen lang sein"
    })
})

export default function Page({
                                 params,
                             }: {
    params: Promise<{ link: string }>
}) {
    const [conference, setConference] = useState<Conference | null>(null)
    const [joined, setJoined] = useState(false)
    const [showText, setShowText] = useState(false);
    const { fetchWithAuth } = useAuth()
    const { link } = use(params);

    useEffect(() => {
        // Show text after 5 seconds
        const timer = setTimeout(() => {
            setShowText(true);
        }, 5000);

        return () => clearTimeout(timer); // Cleanup timer on component unmount
    });

    useEffect(() => {
        const fetchConference = async () => {
            try {
                const res = await fetchWithAuth<Conference>(`/api/conference/${link}`)
                setConference(res)
            } catch (err) {
                console.error(err)
            }
        }

        fetchConference().then()
    }, [link, fetchWithAuth]);

    const form = useForm<z.infer<typeof participantSchema>>({
        resolver: zodResolver(participantSchema),
        defaultValues: {
            password: ""
        }
    })

    function onSubmit(values: z.infer<typeof participantSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        console.log(values)
    }

    if (!conference) {
        return (
            <div className="h-screen w-screen fixed top-0 left-0 z-[-1] flex justify-center items-center flex-col gap-2">
                <LoaderCircle className="animate-spin" />
                {showText && <p className="text-muted-foreground">Die Konferenz ist möglicherweise nicht mehr verfügbar.</p>}
            </div>
        )
    }

    return joined ? (
        <div className="grid grid-cols-[3fr_1fr] grid-rows-[min-content_1fr] h-screen w-screen fixed top-0 left-0 z-[-1]">
            <div className="h-14"></div>
            <div></div>

            <div className="ml-2 mb-2 border rounded-md relative">


                <Button className="absolute bottom-2 left-2" asChild>
                    <Link href="/app">
                        <ArrowLeft/>
                        Verlassen
                    </Link>
                </Button>
            </div>
            <div className="mx-2 mb-2 border rounded-md">
                <ConferenceChat conference={conference} />
            </div>
        </div>
    ) : (
        <div className="flex justify-center items-center h-screen w-screen fixed top-0 left-0 z-[-1]">
            <Tabs defaultValue="viewer" className="w-90">
                <TabsList className="w-full">
                    <TabsTrigger value="viewer">Zuschauer</TabsTrigger>
                    <TabsTrigger value="participant">Teilnehmer</TabsTrigger>
                </TabsList>
                <TabsContent value="viewer">
                    <Card>
                        <CardHeader>
                            <CardTitle>Zuschauer</CardTitle>
                            <CardDescription>Als Zuschauer beitreten</CardDescription>
                        </CardHeader>
                        <CardFooter>
                            <Button className="w-full" onClick={() => setJoined(true)}>
                                Beitreten
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>
                <TabsContent value="participant">
                    <Card>
                        <CardHeader>
                            <CardTitle>Teilnehmer</CardTitle>
                            <CardDescription>Als Teilnehmer mit Kamera und Mikrofon beitreten</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                    <FormField
                                        control={form.control}
                                        name="password"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Passwort</FormLabel>
                                                <FormControl>
                                                    <Input type="text" {...field} autoComplete="off"/>
                                                </FormControl>
                                                <FormDescription>
                                                    Passwort, welches vom Host festgelegt worden ist.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <Button className="w-full">
                                        Beitreten
                                    </Button>
                                </form>
                            </Form>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}