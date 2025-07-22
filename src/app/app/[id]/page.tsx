"use client"

import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {useState} from "react";
import {useForm} from "react-hook-form"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {z} from "zod"
import {zodResolver} from "@hookform/resolvers/zod";
import {Input} from "@/components/ui/input";

const participantSchema = z.object({
    password: z.string().min(8, {
        error: "Passwort muss mindestens 8 Zeichen lang sein"
    })
})

export default function Page() {
    const [joined, setJoined] = useState(false)

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

    return joined ? (
        <div>joined</div>
    ) : (
        <div className="flex justify-center items-center h-screen w-screen fixed top-0 left-0">
            <Tabs defaultValue="viewer">
                <TabsList>
                    <TabsTrigger value="viewer">Zuschauer</TabsTrigger>
                    <TabsTrigger value="participant">Teilnehmer</TabsTrigger>
                </TabsList>
                <TabsContent value="viewer">
                    <Card>
                        <CardHeader>
                            <CardTitle>Zuschauer</CardTitle>
                            <CardDescription>Als Zuschauer beitreten</CardDescription>
                        </CardHeader>
                        <CardFooter className="flex-col">
                            <Button className="w-full">
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
                            {/*TODO: mir reichts das hier geht nicht mach ich nächstes mal*/}
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                                    <FormField
                                        control={form.control}
                                        name="password"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Passwort</FormLabel>
                                                <FormControl>
                                                    <Input type="password" {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    Passwort, welches vom Host festgelegt worden ist.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </form>
                            </Form>
                        </CardContent>
                        <CardFooter className="flex-col">
                            <Button className="w-full">
                                Beitreten
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}