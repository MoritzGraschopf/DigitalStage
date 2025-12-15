"use client"

import React, {useEffect} from "react";
import {z} from "zod";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";

import {
    Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Button} from "@/components/ui/button";
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {Checkbox} from "@/components/ui/checkbox";
import {User} from "@prisma/client";
import {Badge} from "@/components/ui/badge";
import {cn} from "@/lib/utils";
import {useAuth} from "@/context/AuthContext";
import {useWS} from "@/context/WebSocketContext";

// ---------- Utils ----------
const pad = (n: number) => String(n).padStart(2, "0");
const toYYYYMMDDTHHMM = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------- Schema ----------
const conferenceScheme = z.object({
    title: z.string().min(1, {error: "Bitte gib einen Titel an."}).max(20, { error: "Titel darf nur 20 Zeichen lang sein"}).trim(),
    description: z.string().max(120, {error: "Die Beschreibung darf höchstens 120 Zeichen enthalten."}).trim().optional(),
    startAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    userIds: z.array(z.string()).max(10, { error: "Maximal 10 Teilnehmer auswählbar." }),
    presenterUserId: z.string().optional(),
}).refine((d) => {
    const s = new Date(d.startAt);
    const e = new Date(d.endDate);
    return e >= s;
}, {error: "Ende darf nicht vor dem Start liegen.", path: ["endDate"]});

interface NewConferenceSheetProps {
    open: boolean;
    setOpen: (open: boolean) => void;
}

const NewConferenceSheet: React.FC<NewConferenceSheetProps> = ({open, setOpen}) => {
    const { token, user } = useAuth();
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);

    const [users, setUsers] = React.useState<User[]>([]);

    const ws = useWS()

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch("/api/user");
                const data = await res.json();
                setUsers(data as User[]);
            } catch (error) {
                console.error("Error fetching users:", error);
            }
        };
        fetchUsers();
    }, []);

    const form = useForm<z.infer<typeof conferenceScheme>>({
        resolver: zodResolver(conferenceScheme),
        defaultValues: {
            title: "",
            description: "",
            startAt: toYYYYMMDDTHHMM(now),
            endDate: toYYYYMMDDTHHMM(inOneHour),
            userIds: [],
            presenterUserId: undefined,
        },
    });

    const selectedIds = form.watch("userIds") ?? [];
    const presenterUserId = form.watch("presenterUserId");

    const toggleUser = React.useCallback((id: string) => {
        // eigenen User blocken
        if (user && id === user.id) {
            form.setError("userIds", {
                type: "manual",
                message: "Du kannst dich nicht selbst auswählen.",
            });
            return;
        }

        const cur = form.getValues("userIds") ?? [];
        const isSelected = cur.includes(id);

        if (!isSelected && cur.length >= 10) {
            form.setError("userIds", {
                type: "manual",
                message: "Du kannst maximal 10 Teilnehmer auswählen.",
            });
            return;
        }

        const next = isSelected ? cur.filter(x => x !== id) : [...cur, id];
        form.clearErrors("userIds");
        form.setValue("userIds", next, { shouldDirty: true, shouldValidate: true });
    }, [form, user]);

    async function onSubmit(values: z.infer<typeof conferenceScheme>) {
        try {
            const res = await fetch("/api/conference", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token,
                },
                body: JSON.stringify({
                    title: values.title,
                    description: values.description,
                    startAt: values.startAt,
                    endDate: values.endDate,
                    userIds: values.userIds,
                    presenterUserId: values.presenterUserId,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.message || "Erstellen der Konferenz fehlgeschlagen.");
            }

            form.reset({
                title: "",
                description: "",
                startAt: toYYYYMMDDTHHMM(new Date()),
                endDate: toYYYYMMDDTHHMM(new Date(Date.now() + 60 * 60 * 1000)),
                userIds: [],
                presenterUserId: undefined,
            });
            setOpen(false);

            const data = await res.json();

            console.log("res", data)
            ws.send({
                type: "conference",
                id: data.conference.id,
                title: data.conference.title,
                description: data.conference.description,
                startAt: data.conference.startAt,
                endDate: data.conference.endDate,
                status: data.conference.status,
                link: data.conference.link,
                organizerId: data.conference.organizerId,
                participants: data.conference.participants,
            })

            ws?.send({
                type: "ConferenceParticipantsAdded",
                title: data.conference.title,
                conferenceId: data.conference.id,
                link: data.conference.link,
                userIds: values.userIds,          // die eingeladenen User
                organizerId: data.conference.organizerId,
            });
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        } catch (e: never) {
            form.setError("title", {
                type: "server",
                message: e?.message || "Unbekannter Fehler beim Erstellen.",
            });
            console.error("Create conference error:", e);
        }
    }

    // Sichtbare Users: eigenen User herausfiltern
    const visibleUsers = React.useMemo(
        () => users.filter(u => (user ? u.id !== user.id : true)),
        [users, user]
    );

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent className="flex w-full max-w-md flex-col">
                <SheetHeader className="shrink-0">
                    <SheetTitle>Neue Konferenz</SheetTitle>
                    <SheetDescription>Lege eine neue Konferenz an und lade Teilnehmende ein.</SheetDescription>
                </SheetHeader>

                <div className="mt-4 px-2 flex-1 overflow-y-auto">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <FormField
                                control={form.control}
                                name="title"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Titel</FormLabel>
                                        <FormControl>
                                            <Input placeholder="netSolve Krisensitzung" {...field} />
                                        </FormControl>
                                        <FormDescription>Titel der Konferenz</FormDescription>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="description"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Beschreibung</FormLabel>
                                        <FormControl>
                                            <Textarea {...field} />
                                        </FormControl>
                                        <FormDescription>Beschreibung der Konferenz</FormDescription>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="startAt"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Start</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="datetime-local"
                                                {...field}
                                                min={toYYYYMMDDTHHMM(new Date())}
                                            />
                                        </FormControl>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="endDate"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Ende</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="datetime-local"
                                                {...field}
                                                min={form.watch("startAt") || undefined}
                                            />
                                        </FormControl>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="userIds"
                                render={() => (
                                    <FormItem>
                                        <FormLabel>Teilnehmer</FormLabel>

                                        {selectedIds.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                                {users
                                                    .filter((u) => selectedIds.includes(u.id))
                                                    .map((u) => (
                                                        <Badge
                                                            key={u.id}
                                                            variant="secondary"
                                                            className="cursor-pointer"
                                                            onClick={() => toggleUser(u.id)}
                                                        >
                                                            {u.firstName + " " + u.lastName}
                                                        </Badge>
                                                    ))}
                                            </div>
                                        )}

                                        <FormControl>
                                            <Command
                                                className={cn(
                                                    "rounded-md border",
                                                    form.formState.errors.userIds
                                                        ? "border-destructive text-destructive focus-visible:ring-destructive"
                                                        : "border-input focus-visible:ring-ring"
                                                )}
                                            >
                                                <CommandInput placeholder="User suchen..." />
                                                <CommandList>
                                                    <CommandEmpty>Keine User gefunden.</CommandEmpty>
                                                    <CommandGroup heading="Users">
                                                        {visibleUsers.map((u) => {
                                                            const checked = selectedIds.includes(u.id);
                                                            const atLimit = selectedIds.length >= 10;

                                                            return (
                                                                <CommandItem
                                                                    key={u.id}
                                                                    onMouseDown={(e) => e.preventDefault()}
                                                                    onSelect={() => toggleUser(u.id)}
                                                                    className="flex items-center gap-2"
                                                                >
                                                                    <div
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        onMouseDown={(e) => e.preventDefault()}
                                                                    >
                                                                        <Checkbox
                                                                            checked={checked}
                                                                            disabled={!checked && atLimit}
                                                                            onCheckedChange={() => toggleUser(u.id)}
                                                                        />
                                                                    </div>
                                                                    <span className="truncate">
                                                                        {u.firstName} {u.lastName ?? ""}
                                                                    </span>
                                                                </CommandItem>
                                                            );
                                                        })}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </FormControl>

                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="presenterUserId"
                                render={() => (
                                    <FormItem>
                                        <FormLabel>Präsentator (optional)</FormLabel>
                                        <FormDescription>
                                            Wähle einen Präsentator aus. Du kannst dies auch später in der Konferenz ändern.
                                        </FormDescription>

                                        {presenterUserId && (
                                            <div className="mt-2">
                                                {(() => {
                                                    const presenter = users.find(u => u.id === presenterUserId);
                                                    return presenter ? (
                                                        <Badge
                                                            variant="default"
                                                            className="cursor-pointer"
                                                            onClick={() => form.setValue("presenterUserId", undefined)}
                                                        >
                                                            {presenter.firstName} {presenter.lastName ?? ""} (Präsentator)
                                                        </Badge>
                                                    ) : null;
                                                })()}
                                            </div>
                                        )}

                                        <FormControl>
                                            <Command className="rounded-md border">
                                                <CommandInput placeholder="Präsentator suchen..." />
                                                <CommandList>
                                                    <CommandEmpty>Keine User gefunden.</CommandEmpty>
                                                    <CommandGroup heading="Als Präsentator auswählen">
                                                        {/* Organizer (selbst) */}
                                                        {user && (
                                                            <CommandItem
                                                                onSelect={() => {
                                                                    const newValue = presenterUserId === user.id ? undefined : user.id;
                                                                    form.setValue("presenterUserId", newValue);
                                                                }}
                                                                className="flex items-center gap-2"
                                                            >
                                                                <div onClick={(e) => e.stopPropagation()}>
                                                                    <Checkbox
                                                                        checked={presenterUserId === user.id}
                                                                        onCheckedChange={() => {
                                                                            const newValue = presenterUserId === user.id ? undefined : user.id;
                                                                            form.setValue("presenterUserId", newValue);
                                                                        }}
                                                                    />
                                                                </div>
                                                                <span className="truncate">
                                                                    {user.firstName} {user.lastName ?? ""} (Du - Organizer)
                                                                </span>
                                                            </CommandItem>
                                                        )}
                                                        {/* Ausgewählte Teilnehmer */}
                                                        {users
                                                            .filter((u) => selectedIds.includes(u.id))
                                                            .map((u) => (
                                                                <CommandItem
                                                                    key={u.id}
                                                                    onSelect={() => {
                                                                        const newValue = presenterUserId === u.id ? undefined : u.id;
                                                                        form.setValue("presenterUserId", newValue);
                                                                    }}
                                                                    className="flex items-center gap-2"
                                                                >
                                                                    <div onClick={(e) => e.stopPropagation()}>
                                                                        <Checkbox
                                                                            checked={presenterUserId === u.id}
                                                                            onCheckedChange={() => {
                                                                                const newValue = presenterUserId === u.id ? undefined : u.id;
                                                                                form.setValue("presenterUserId", newValue);
                                                                            }}
                                                                        />
                                                                    </div>
                                                                    <span className="truncate">
                                                                        {u.firstName} {u.lastName ?? ""}
                                                                    </span>
                                                                </CommandItem>
                                                            ))}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </FormControl>

                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <button type="submit" className="hidden"/>
                        </form>
                    </Form>
                </div>

                <SheetFooter className="sticky bottom-0 mt-2 bg-background/80 py-3 backdrop-blur">
                    <div className="ml-auto flex gap-2">
                        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>Abbrechen</Button>
                        <Button type="button" onClick={form.handleSubmit(onSubmit)}>Erstellen</Button>
                    </div>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
};

export default NewConferenceSheet;
