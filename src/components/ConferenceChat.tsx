"use client"

import {z} from "zod";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {Form, FormControl, FormField, FormItem} from "@/components/ui/form";
import {Button} from "@/components/ui/button";
import {SendHorizonal} from "lucide-react";
import {Input} from "@/components/ui/input";
import {useCallback, useEffect, useState} from "react";
import {cn} from "@/lib/utils";
import {ChatMessage, Conference, User} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import {ScrollArea} from "@/components/ui/scroll-area";

type ChatMessageWithUser = ChatMessage & { user: User }

const messageSchema = z.object({
    message: z.string().trim().min(1, {
        error: "Nachricht darf nicht leer sein"
    })
})

export default function ConferenceChat({conference, disabled}: { conference: Conference, disabled: boolean }) {
    const {user, token} = useAuth()
    const [messages, setMessages] = useState<ChatMessageWithUser[]>([])
    const [ws, setWs] = useState<WebSocket | null>(null);

    const fetchMessages = useCallback(async () => {
        const res = await fetch(`/api/chatMessage?conferenceId=${conference.id}`, {
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json"
            }
        })
        const data = await res.json()
        setMessages(data.chatMessages)
    }, [conference.id, token])


    useEffect(() => {
        fetchMessages().then()
    }, [fetchMessages]);

    useEffect(() => {
        const socket = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);

        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'chatMessage') {
                setMessages((prev) => [...prev, msg]);
            }
        };

        setWs(socket);
        return () => socket.close();
    }, []);

    useEffect(() => {
        if (!ws) return;
        ws.onopen = () => {
            ws.send(JSON.stringify({
                type: "init",
                conferenceId: conference.id,
            }));
        };
    }, [ws, conference.id]);

    const form = useForm<z.infer<typeof messageSchema>>({
        resolver: zodResolver(messageSchema),
        defaultValues: {
            message: ""
        }
    })

    async function onSubmit(values: z.infer<typeof messageSchema>) {
        await fetch(`/api/chatMessage?conferenceId=${conference.id}`, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: values.message
            })
        })
        if (!!ws) ws.send(JSON.stringify({
            type: "chatMessage",
            message: values.message,
            userId: user?.id,
            conferenceId: conference.id,
            name: user?.name
        }));

        await fetchMessages()
        form.reset()
    }

    return (
        <div className="h-full flex flex-col-reverse gap-2">
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-[1fr_min-content] m-2 gap-2">
                    <FormField
                        control={form.control}
                        name="message"
                        render={({field}) => (
                            <FormItem>
                                <FormControl>
                                    <Input type="text" {...field} autoComplete="off"/>
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <Button size="icon" type="submit" disabled={disabled}>
                        <SendHorizonal/>
                    </Button>
                </form>
            </Form>

            <ScrollArea className="h-full overflow-y-auto">
                <div className="flex flex-col-reverse justify-end h-full gap-2 flex-grow mx-2 mt-2">
                    <div className="flex-grow" /> {/* Platzhalter für flexibles Layout */}
                    {messages.length > 0 &&
                        messages.toReversed().map((message, index) => (
                            <div
                                key={index}
                                className={cn(
                                    `p-2 bg-accent text-accent-foreground mx-2 rounded-md w-max flex flex-col 
                        ${message.user.id === user?.id ? "self-end text-right" : "self-start"}`
                                )}
                            >
                                <span className="text-muted-foreground text-sm">{message.user.name}</span>
                                <span>{message.message}</span>
                            </div>
                        ))}
                </div>
            </ScrollArea>
        </div>
    )
}