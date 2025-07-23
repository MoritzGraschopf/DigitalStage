"use client"

import {z} from "zod";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {Form, FormControl, FormField, FormItem} from "@/components/ui/form";
import {Button} from "@/components/ui/button";
import {SendHorizonal} from "lucide-react";
import {Input} from "@/components/ui/input";

const messageSchema = z.object({
    message: z.string().trim().min(1, {
        error: "Nachricht darf nicht leer sein"
    })
})

export default function ConferenceChat() {
    const form = useForm<z.infer<typeof messageSchema>>({
        resolver: zodResolver(messageSchema),
        defaultValues: {
            message: ""
        }
    })

    function onSubmit(values: z.infer<typeof messageSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        console.log(values)
    }

    return (
        <div className="h-full flex flex-col-reverse">
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
        </div>
    )
}