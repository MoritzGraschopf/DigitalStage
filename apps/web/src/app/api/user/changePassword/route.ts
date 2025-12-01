import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromAuthHeader } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromAuthHeader(req.headers.get("authorization"));
        if (!userId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const { currentPassword, newPassword } = await req.json();

        if (!currentPassword || !newPassword) {
            return NextResponse.json({ message: "Felder fehlen" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, passwordHash: true },
        });

        if (!user?.passwordHash) {
            return NextResponse.json({ message: "Benutzer nicht gefunden" }, { status: 404 });
        }

        const ok = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!ok) {
            return NextResponse.json({ message: "Aktuelles Passwort ist falsch" }, { status: 400 });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash: hashed },
        });

        return NextResponse.json({ message: "Passwort aktualisiert" }, { status: 200 });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ message: "Serverfehler" }, { status: 500 });
    }
}
