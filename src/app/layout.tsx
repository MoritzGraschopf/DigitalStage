import type {Metadata} from "next";
import {Geist, Geist_Mono} from "next/font/google";
import "./globals.css";
import React from "react";
import {AuthProvider} from "@/context/AuthContext";
import {WebSocketProvider} from "@/context/WebSocketContext";
import {Toaster} from "@/components/ui/sonner";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "DigitalStage",
    description: "Streamen, zuschauen und chatten – alles in Echtzeit für deine Online-Konferenz."
};

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="de">
        <body
            className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
            <AuthProvider>
                <WebSocketProvider>
                    {children}
                    <Toaster position="top-center" richColors/>
                </WebSocketProvider>
            </AuthProvider>
        </body>
        </html>
    );
}
