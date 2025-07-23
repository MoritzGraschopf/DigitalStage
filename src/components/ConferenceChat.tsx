"use client"

import {z} from "zod";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {Form, FormControl, FormField, FormItem} from "@/components/ui/form";
import {Button} from "@/components/ui/button";
import {SendHorizonal} from "lucide-react";
import {Input} from "@/components/ui/input";
import {useState} from "react";
import {cn} from "@/lib/utils";

type message = {
    sender: string | "self",
    message: string
}

const messageSchema = z.object({
    message: z.string().trim().min(1, {
        error: "Nachricht darf nicht leer sein"
    })
})

export default function ConferenceChat() {
    const [messages, setMessages] = useState<message[]>([{
        message: "Benis",
        sender: "Bob"
    }])

    const form = useForm<z.infer<typeof messageSchema>>({
        resolver: zodResolver(messageSchema),
        defaultValues: {
            message: ""
        }
    })

    function onSubmit(values: z.infer<typeof messageSchema>) {
        setMessages((prev) => prev.concat({
            message: values.message,
            sender: "self"
        }))
        form.reset()
    }

    return (
        <div className="h-full flex flex-col-reverse gap-2">
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-[1fr_min-content] m-2 gap-2">
                    <FormField
                        control={form.control}
                        name="message"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <Input type="text" {...field} autoComplete="off"/>
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <Button size="icon" type="submit">
                        <SendHorizonal/>
                    </Button>
                </form>
            </Form>

            {messages.toReversed().map((message, index) => (
                <div key={index} className={cn(`p-2 bg-accent text-accent-foreground mx-2 rounded-md w-max flex flex-col 
                                            ${message.sender === "self" ? "self-end text-right" : "self-start"}`)}>
                    <span className="text-muted-foreground text-sm">{message.sender === "self" ? "Du" /*TODO: hier Username vom aktuellen Nutzer irgendwie einfügen oder Kontrolle ob es der aktuelle Nutzer ist usw.*/ : message.sender}</span>
                    <span>{message.message}</span>
                </div>
            ))}
        </div>
    )
}