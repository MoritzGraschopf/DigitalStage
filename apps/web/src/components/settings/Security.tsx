"use client"

import React from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import {NewPasswordInput} from "@/components/settings/NewPasswordInput"; // oder dein Toast-System

const schema = z.object({
    currentPassword: z.string().min(8, "Mindestens 8 Zeichen").trim(),
    newPassword: z.string().min(8, "Mindestens 8 Zeichen").trim(),
    confirmPassword: z.string().min(8, "Mindestens 8 Zeichen").trim(),
}).refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwörter stimmen nicht überein",
});

type FormValues = z.infer<typeof schema>;

const SecurityPage: React.FC = () => {
    const { token } = useAuth();

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
        },
    });

    const onSubmit = async (values: FormValues) => {
        try {
            const res = await fetch("/api/user/changePassword", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    currentPassword: values.currentPassword,
                    newPassword: values.newPassword,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.message || "Ändern fehlgeschlagen");
            }

            toast?.success?.("Passwort aktualisiert");
            form.reset();
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
        } catch (e: never) {
            toast?.error?.(e.message! || "Fehler beim Aktualisieren");
        }
    };

    return (
        <div className="p-6">
            <h1 className="text-lg font-medium mb-4">Sicherheit</h1>
            <Separator className="my-2" />

            <div className="mt-4 w-full space-y-4">
                <h2 className="text-base font-medium mb-2">Passwort ändern</h2>
                <p className="text-sm text-muted-foreground mb-4">
                    Gib dein aktuelles Passwort ein und wähle ein neues, starkes Passwort.
                </p>

                <Form {...form}>
                    {/* GANZ WICHTIG: Form NICHT deaktivieren */}
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" autoComplete="on">
                        <FormField
                            control={form.control}
                            name="currentPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Aktuelles Passwort</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            id="current-password"
                                            name="current-password"           // sprechender Name hilft Managern
                                            type="password"
                                            autoComplete="current-password"   // ✨ Triggert Keychain/Manager
                                            autoCapitalize="off"
                                            spellCheck={false}
                                            inputMode="text"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="newPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Neues Passwort</FormLabel>
                                    <FormControl>
                                        <NewPasswordInput {...field}/>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="confirmPassword"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Neues Passwort bestätigen</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            id="confirm-password"
                                            name="confirm-password"
                                            type="password"
                                            autoComplete="new-password"       // auch hier „new-password“
                                            autoCapitalize="off"
                                            spellCheck={false}
                                            inputMode="text"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? "Speichere…" : "Passwort ändern"}
                        </Button>
                    </form>
                </Form>

            </div>
        </div>
    );
};

export default SecurityPage;
