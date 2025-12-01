import React from "react";

export default function AuthLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <main className="h-screen flex justify-center items-center">
            {children}
        </main>
    )
}