import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        // Wähle nur „sichere“ Felder aus – KEINE Passwörter, Tokens, etc.
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
            },
        });

        return NextResponse.json(users, {
            status: 200,
        });
    } catch (err) {
        console.error("[GET /api/users] ", err);
        return NextResponse.json(
            { error: "Failed to load users" },
            { status: 500 }
        );
    }
}