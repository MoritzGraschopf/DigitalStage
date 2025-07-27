import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {useForm} from "react-hook-form";
import {z} from "zod";
import {zodResolver} from "@hookform/resolvers/zod";
import {useAuth} from "@/context/AuthContext";

const loginSchema = z.object({
    email: z.email({
        error: "Invalide Email Addresse"
    }),
    password: z.string().min(8, {
        error: "Passwort muss mindestens 8 Zeichen lang sein"
    }).max(20, {
        error: "Passwort darf maximal 20 Zeichen lang sein"
    })
})

export default function LoginForm() {
    const { login } = useAuth()

    const form = useForm<z.infer<typeof loginSchema>>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: "",
            password: "",
        },
    })

    // 2. Define a submit handler.
    async function onSubmit(values: z.infer<typeof loginSchema>) {
        // Do something with the form values.
        // ✅ This will be type-safe and validated.
        console.log(values)

        await login(values.email, values.password)
            .catch(error => {
                console.log(error)

                if (error.message === "Login fehlgeschlagen") {
                    form.setError("email", { message: "Ungültige E-Mail oder Passwort" });
                } else {
                    form.setError("email", { message: "Ein unbekannter Fehler ist aufgetreten" });
                }
            })
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
                                Email die Sie beim Registrieren verwendet haben
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
                                <Input type="password" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit">Anmelden</Button>
            </form>
        </Form>
    )
}