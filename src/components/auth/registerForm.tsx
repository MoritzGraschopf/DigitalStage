"use client"

import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/context/AuthContext";
import {useSearchParams} from "next/navigation";

const registerSchema = z.object({
    email: z.email({
        error: "Invalide Email Addresse",
    }),
    firstName: z.string().min(1, {
        error: "Vorname muss ausgefüllt werden",
    }).max(30, {
        error: "Vorname darf maximal 30 Zeichen lang sein",
    }),
    lastName: z.string().min(1, {
        error: "Nachname muss ausgefüllt werden",
    }).max(30, {
        error: "Nachname darf maximal 30 Zeichen lang sein",
    }),
    password: z.string().min(8, {
        error: "Passwort muss mindestens 8 Zeichen lang sein",
    }).max(20, {
        error: "Passwort darf maximal 20 Zeichen lang sein",
    }),
});

export default function RegisterForm() {
    const { register } = useAuth(); // Importiere register aus dem Auth-Kontext
    const searchParams = useSearchParams();
    const redirect = searchParams.get('redirect') || '/app';

    const form = useForm<z.infer<typeof registerSchema>>({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            email: "",
            firstName: "",
            lastName: "",
            password: "",
        },
    });

    async function onSubmit(values: z.infer<typeof registerSchema>) {
        try {
            await register(values.email, values.firstName, values.lastName, values.password, redirect)
            console.log('Erfolgreich registriert!');
        } catch (error) {
            if (error instanceof Error) {
                if (error.message === "User already exists. Please use a different email.") {
                    form.setError("email", { message: "Ein Benutzer mit dieser Email existiert bereits" });
                } else {
                    console.error('Registrierung fehlgeschlagen:', error);
                }
            }
        }
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input placeholder="j.toifl@htlkrems.at" {...field} />
                            </FormControl>
                            <FormDescription>
                                Email die Sie zum Registrieren verwenden wollen
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Firstname</FormLabel>
                            <FormControl>
                                <Input placeholder="Jacob" {...field} />
                            </FormControl>
                            <FormDescription>
                                Name der den anderen Benutzern angezeigt wird
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Lastname</FormLabel>
                            <FormControl>
                                <Input placeholder="Toifl" {...field} />
                            </FormControl>
                            <FormDescription>
                                Name der den anderen Benutzern angezeigt wird
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Passwort</FormLabel>
                            <FormControl>
                                <Input type="password" placeholder="••••••••" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit" size="sm">Registrieren</Button>
            </form>
        </Form>
    );
}