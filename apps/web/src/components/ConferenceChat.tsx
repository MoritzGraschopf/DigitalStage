"use client"

import {z} from "zod";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {Form, FormControl, FormField, FormItem} from "@/components/ui/form";
import {Button} from "@/components/ui/button";
import {SendHorizonal, ArrowDown} from "lucide-react";
import {Input} from "@/components/ui/input";
import React, {useCallback, useEffect, useRef, useState} from "react";
import {cn} from "@/lib/utils";
import {ChatMessage, Conference, User} from "@prisma/client";
import {useAuth} from "@/context/AuthContext";
import {ScrollArea} from "@/components/ui/scroll-area";
import {useWS} from "@/context/WebSocketContext";

type ChatMessageWithUser = ChatMessage & { user: User }

const messageSchema = z.object({
    message: z.string().trim().min(1, { error: "Nachricht darf nicht leer sein" })
})

export default function ConferenceChat({conference, disabled}: { conference: Conference, disabled: boolean }) {
    const {user, token} = useAuth()
    const [messages, setMessages] = useState<ChatMessageWithUser[]>([])
    const ws = useWS()

    // --- Scroll handling (IntersectionObserver) ---
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const [isAtBottom, setIsAtBottom] = useState(true)
    const [unreadCount, setUnreadCount] = useState(0)
    const wasAtBottomRef = useRef(true)
    const rafRef = useRef<number | null>(null)
    const EPS = 48 // Toleranz in px (gerne auf 32/64 tweaken)

    const computeIsAtBottom = () => {
        const el = viewportRef.current
        if (!el) return true
        // Abstand vom "echten" Ende
        const distance = el.scrollHeight - el.clientHeight - el.scrollTop
        return distance <= EPS
    }

    const handleViewportScroll: React.UIEventHandler<HTMLDivElement> = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
            const atBottomNow = computeIsAtBottom()
            setIsAtBottom(atBottomNow)
            if (atBottomNow) setUnreadCount(0)
        })
    }

    useEffect(() => { wasAtBottomRef.current = isAtBottom }, [isAtBottom])

    const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
        const el = viewportRef.current
        if (!el) return
        el.scrollTo({ top: el.scrollHeight, behavior })
        setIsAtBottom(true)
        setUnreadCount(0)
    }
// --- /NEU ---

    // --- /Scroll handling ---

    const fetchMessages = useCallback(async () => {
        const res = await fetch(`/api/chatMessage?conferenceId=${conference.id}`, {
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json"
            }
        })
        const data = await res.json()
        setMessages(data.chatMessages)
        // initial unten positionieren
        requestAnimationFrame(() => scrollToBottom("auto"))
    }, [conference.id, token])

    useEffect(() => { fetchMessages() }, [fetchMessages])

    // Bei neuen Messages NUR auto-scrollen, wenn man vorher unten war oder selbst geschrieben hat
    useEffect(() => {
        if (messages.length === 0) return
        const last = messages[messages.length - 1]
        const iWrote = last?.user?.id === user?.id
        if (wasAtBottomRef.current || iWrote) scrollToBottom("auto")
        else setUnreadCount((n) => n + 1)
    }, [messages, user?.id])

    useEffect(() => {
        ws.send({type: "init", userId: user?.id, inConference: true, conferenceId: conference.id})
    }, [ws, user?.id, conference.id]);

    useEffect(() => {
        ws.on("server:chatMessage", (message) => {
            console.log("server:chatMessage", message)
            const formatMessage = message as ChatMessageWithUser
            setMessages((prev) => {
                if (prev.some(c => c.id === formatMessage.id)) return prev;
                return [...prev, formatMessage]
            })
        })
    }, [ws]);

    const form = useForm<z.infer<typeof messageSchema>>({
        resolver: zodResolver(messageSchema),
        defaultValues: { message: "" }
    })

    async function onSubmit(values: z.infer<typeof messageSchema>) {
        const res = await fetch(`/api/chatMessage?conferenceId=${conference.id}`, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message: values.message })
        })

        const data = await res.json()

        ws.send({
            type: "chatMessage",
            id: data.chatMessage.id,
            message: values.message,
            userId: user?.id,
            conferenceId: conference.id,
            user: {
                firstName: user?.firstName,
                lastName: user?.lastName
            }
        })

        // await fetchMessages()
        form.reset()
        // eigene Nachricht -> sofort nach unten
        scrollToBottom()
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* Wichtig: viewportClassName="relative" für den Floating-Button */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
                <ScrollArea
                    className="h-full"
                    viewportRef={viewportRef}
                    viewportClassName="h-full w-full"
                    onViewportScroll={handleViewportScroll}
                >
                    <div className="px-2 pl-2 pr-4 py-4 space-y-2">
                        {messages.map((message, index) => (
                            <div
                                key={index}
                                className={cn(
                                    "p-2 bg-accent text-accent-foreground rounded-md w-max flex flex-col",
                                    message.userId === user?.id ? "ml-auto text-right" : "mr-auto"
                                )}
                            >
                                <span className="text-muted-foreground text-sm">{message.user.firstName + " " + message.user.lastName}</span>
                                <span>{message.message}</span>
                            </div>
                        ))}
                        <div ref={bottomRef} className="h-px" />
                    </div>
                </ScrollArea>

                {!isAtBottom && (
                    <div className="pointer-events-none absolute bottom-4 right-4">
                        <Button
                            onClick={() => scrollToBottom("smooth")}
                            variant="secondary"
                            size="sm"
                            className="pointer-events-auto shadow"
                            aria-label="Zum neuesten Nachrichten springen"
                        >
                            <ArrowDown className="mr-2 h-4 w-4" />
                            Zum neuesten{unreadCount ? ` (${unreadCount})` : ""}
                        </Button>
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 border-t p-2">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-[1fr_min-content] gap-2">
                        <FormField
                            control={form.control}
                            name="message"
                            render={({field}) => (
                                <FormItem>
                                    <FormControl>
                                        <Input type="text" {...field} autoComplete="off" />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <Button size="icon" type="submit" disabled={disabled}>
                            <SendHorizonal />
                        </Button>
                    </form>
                </Form>
            </div>
        </div>
    )
}
