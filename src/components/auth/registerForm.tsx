import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/context/AuthContext";

const registerSchema = z.object({
    email: z.email({
        error: "Invalide Email Addresse",
    }),
    username: z.string().min(1, {
        error: "Name muss ausgefüllt werden",
    }).max(30, {
        error: "Name darf maximal 30 Zeichen lang sein",
    }),
    password: z.string().min(8, {
        error: "Passwort muss mindestens 8 Zeichen lang sein",
    }).max(20, {
        error: "Passwort darf maximal 20 Zeichen lang sein",
    }),
});

export default function RegisterForm() {
    const form = useForm<z.infer<typeof registerSchema>>({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            email: "",
            username: "",
            password: "",
        },
    });

    const { register } = useAuth(); // Importiere register aus dem Auth-Kontext

    async function onSubmit(values: z.infer<typeof registerSchema>) {
        try {
            await register(values.email, values.username, values.password); // Registrierung mit register() ausführen
            console.log('Erfolgreich registriert!');
        } catch (error) {
            console.error('Registrierung fehlgeschlagen:', error);
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
                    name="username"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input placeholder="Jacob Toifl" {...field} />
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
                <Button type="submit">Registrieren</Button>
            </form>
        </Form>
    );
}