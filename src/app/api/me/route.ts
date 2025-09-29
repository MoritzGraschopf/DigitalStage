import {NextRequest, NextResponse} from "next/server";
import {prisma} from "@/lib/prisma"; // Prisma korrekt importieren
import {verifyToken} from "@/lib/auth"; // Verifizierungsfunktion aus deiner auth.ts

export async function GET(req: NextRequest) {
    try {
        // Token aus dem Header erhalten (z. B. "Authorization: Bearer <token>")
        const authHeader = req.headers.get("authorization");
        if (!authHeader) {
            return NextResponse.json(
                {error: "Kein Token vorhanden"},
                {status: 401}
            );
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return NextResponse.json(
                {error: "Token ist ungültig oder fehlt"},
                {status: 401}
            );
        }

        // Token verifizieren
        const payload = verifyToken(token); // Enthält userId und email aus deinem JWT
        const userId = payload.userId;

        // Benutzerdaten aus der Datenbank abrufen
        const user = await prisma.user.findUnique({
            where: {id: userId},
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                organizedConferences:true,
                chatMessages: true,
                participations: true,
            },

        });

        if (!user) {
            return NextResponse.json(
                {error: "Benutzer nicht gefunden"},
                {status: 404}
            );
        }

        // Erfolgreiche Antwort mit den Benutzerdaten
        return NextResponse.json(user, {status: 200});
    } catch (error) {
        console.error("Fehler beim Abrufen der Benutzerdaten:", error);

        return NextResponse.json(
            {error: "Ein Fehler ist aufgetreten"},
            {status: 500}
        );
    }
}