import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromAuthHeader } from "@/lib/auth";

// POST: Fragesteller aktivieren (VIEWER → QUESTIONER, HLS → WebRTC)
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ link: string; userId: string }> }
) {
    try {
        const organizerId = getUserIdFromAuthHeader(req.headers.get("authorization"));
        if (!organizerId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const { link, userId } = await params;

        const conf = await prisma.conference.findUnique({
            where: { link },
            select: { id: true, organizerId: true },
        });

        if (!conf) {
            return NextResponse.json({ message: "Conference not found" }, { status: 404 });
        }

        if (conf.organizerId !== organizerId) {
            return NextResponse.json({ message: "Forbidden, organizer only" }, { status: 403 });
        }

        // Prüfe ob User in der Konferenz ist
        const userConference = await prisma.userConference.findUnique({
            where: {
                userId_conferenceId: { userId, conferenceId: conf.id },
            },
            select: { role: true },
        });

        if (!userConference) {
            return NextResponse.json({ message: "User is not in this conference" }, { status: 404 });
        }

        // Nur VIEWER können zu QUESTIONER werden
        if (userConference.role !== "VIEWER") {
            return NextResponse.json({ message: "Only viewers can become questioners" }, { status: 400 });
        }

        // Prüfe maximale Anzahl von WebRTC-Teilnehmern
        // WebRTC-Teilnehmer sind: Organizer (wenn nicht VIEWER), Präsentator (wenn nicht Organizer), Fragesteller
        const allParticipants = await prisma.userConference.findMany({
            where: { conferenceId: conf.id },
            select: {
                userId: true,
                role: true,
                isPresenter: true,
            },
        });

        // Zähle aktuelle WebRTC-Teilnehmer
        let webrtcCount = 0;
        let hasExternalPresenter = false;

        for (const p of allParticipants) {
            // Organizer ist immer WebRTC-Teilnehmer (wenn nicht VIEWER)
            if (p.userId === conf.organizerId && p.role !== "VIEWER") {
                webrtcCount++;
            }
            // Externer Präsentator ist WebRTC-Teilnehmer
            if (p.isPresenter && p.userId !== conf.organizerId) {
                webrtcCount++;
                hasExternalPresenter = true;
            }
            // Fragesteller ist WebRTC-Teilnehmer
            if (p.role === "QUESTIONER") {
                webrtcCount++;
            }
        }

        // Maximale Anzahl: 2 wenn Organizer präsentiert, 3 wenn externer Präsentator
        const maxWebRTC = hasExternalPresenter ? 3 : 2;

        if (webrtcCount >= maxWebRTC) {
            return NextResponse.json(
                { 
                    message: `Maximum number of WebRTC participants reached (${maxWebRTC}). Cannot activate another questioner.`,
                    currentCount: webrtcCount,
                    maxCount: maxWebRTC
                },
                { status: 400 }
            );
        }

        // Ändere Rolle zu QUESTIONER
        await prisma.userConference.update({
            where: {
                userId_conferenceId: { userId, conferenceId: conf.id },
            },
            data: {
                role: "QUESTIONER",
            },
        });

        // WebSocket-Event wird vom Client gesendet (siehe Frontend)
        return NextResponse.json({ message: "Questioner activated", userId, conferenceId: conf.id, link }, { status: 200 });
    } catch (err) {
        console.error("Activate questioner error:", err);
        return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
    }
}

// DELETE: Fragesteller deaktivieren (QUESTIONER → VIEWER, WebRTC → HLS)
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ link: string; userId: string }> }
) {
    try {
        const organizerId = getUserIdFromAuthHeader(req.headers.get("authorization"));
        if (!organizerId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const { link, userId } = await params;

        const conf = await prisma.conference.findUnique({
            where: { link },
            select: { id: true, organizerId: true },
        });

        if (!conf) {
            return NextResponse.json({ message: "Conference not found" }, { status: 404 });
        }

        if (conf.organizerId !== organizerId) {
            return NextResponse.json({ message: "Forbidden, organizer only" }, { status: 403 });
        }

        // Prüfe ob User QUESTIONER ist
        const userConference = await prisma.userConference.findUnique({
            where: {
                userId_conferenceId: { userId, conferenceId: conf.id },
            },
            select: { role: true },
        });

        if (!userConference || userConference.role !== "QUESTIONER") {
            return NextResponse.json({ message: "User is not a questioner" }, { status: 400 });
        }

        // Ändere Rolle zurück zu VIEWER
        await prisma.userConference.update({
            where: {
                userId_conferenceId: { userId, conferenceId: conf.id },
            },
            data: {
                role: "VIEWER",
            },
        });

        // WebSocket-Event wird vom Client gesendet (siehe Frontend)
        return NextResponse.json({ message: "Questioner deactivated", userId, conferenceId: conf.id, link }, { status: 200 });
    } catch (err) {
        console.error("Deactivate questioner error:", err);
        return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
    }
}

