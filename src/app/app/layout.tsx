import React from "react";
import LayoutMenuBar from "@/components/LayoutMenuBar";


export default function AppLayout({
                                      children,
                                  }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <>
            <LayoutMenuBar />
            <main>
                {children}
            </main>
        </>
    )
}