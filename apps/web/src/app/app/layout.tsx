"use client"

import React, {useEffect} from "react";
import LayoutMenuBar from "@/components/LayoutMenuBar";
import {useAuth} from "@/context/AuthContext";
import {usePathname, useRouter} from "next/navigation";
import {LoaderCircle} from "lucide-react";

export default function AppLayout({
                                      children,
                                  }: Readonly<{
    children: React.ReactNode;
}>) {
    const { isAuthenticated, loading, logout } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!loading && !isAuthenticated) {
            router.push(`/auth?redirect=${pathname}`);
        }
    }, [loading, isAuthenticated, router, pathname]);

    if (!isAuthenticated) return <div className="text-xl h-screen grid place-items-center">Weiterleitung...</div>

    return loading ? <div className="h-screen grid place-items-center">
        <LoaderCircle className="animate-spin" />
    </div> : (
        <>
            <LayoutMenuBar logoutAction={logout} />
            <main className="h-full">
                {children}
            </main>
        </>
    )
}