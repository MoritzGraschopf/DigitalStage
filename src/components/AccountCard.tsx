"use client"

import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {useAuth} from "@/context/AuthContext";

export default function AccountCard() {
    const { user } = useAuth()

    return (
        <Card className="w-90">
            <CardHeader>
                <CardTitle>{user?.name}</CardTitle>
                <CardDescription>
                    {user?.email}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <p>Card Content</p>
            </CardContent>
            <CardFooter>
                <p>Card Footer</p>
            </CardFooter>
        </Card>
    )
}