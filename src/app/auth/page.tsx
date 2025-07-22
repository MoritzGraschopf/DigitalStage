"use client"

import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import LoginForm from "@/components/auth/loginForm";
import RegisterForm from "@/components/auth/registerForm";

export default function LoginPage() {
    return (
        <div>
            <Tabs defaultValue="login">
                <TabsList className="w-full">
                    <TabsTrigger value="login">Anmelden</TabsTrigger>
                    <TabsTrigger value="register">Registrieren</TabsTrigger>
                </TabsList>
                <TabsContent value="login">
                    <Card>
                        <CardHeader>
                            <CardTitle>Anmelden</CardTitle>
                            <CardDescription>
                                Melde dich an um einer Konferenz beizutreten
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <LoginForm />
                        </CardContent>
                    </Card>
                </TabsContent>
                <TabsContent value="register">
                    <Card>
                        <CardHeader>
                            <CardTitle>Registrieren</CardTitle>
                            <CardDescription>
                                Registriere dich um eine Konferenz zu beitreten
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <RegisterForm />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}