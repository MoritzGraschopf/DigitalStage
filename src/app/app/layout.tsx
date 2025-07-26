"use client"

import React, {useEffect} from "react";
import LayoutMenuBar from "@/components/LayoutMenuBar";
import {useAuth} from "@/context/AuthContext";
import {useRouter} from "next/navigation";
import {LoaderCircle} from "lucide-react";

export default function AppLayout({
                                      children,
                                  }: Readonly<{
    children: React.ReactNode;
}>) {
    const { isAuthenticated, loading, logout } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !isAuthenticated) {
            router.push('/auth');
        }
    }, [loading, isAuthenticated, router]);

    if (!isAuthenticated) return <div className="text-xl h-screen grid place-items-center">Weiterleitung...</div>

    return loading ? <div className="h-screen grid place-items-center">
        <LoaderCircle className="animate-spin" />
    </div> : (
        <>
            <LayoutMenuBar logout={logout} />
            <main className="h-full">
                {children}
            </main>
        </>
    )
}