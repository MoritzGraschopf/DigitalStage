import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromAuthHeader } from "@/lib/auth";

// POST: Präsentator setzen
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ link: string }> }
) {
    try {
        const organizerId = getUserIdFromAuthHeader(req.headers.get("authorization"));
        if (!organizerId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const { link } = await params;
        const body = await req.json().catch(() => ({}));
        const { userId } = body;

        if (!userId || typeof userId !== "string") {
            return NextResponse.json({ message: "userId is required" }, { status: 400 });
        }

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

        const userConference = await prisma.userConference.findUnique({
            where: {
                userId_conferenceId: { userId, conferenceId: conf.id },
            },
            select: { role: true },
        });

        if (!userConference) {
            return NextResponse.json({ message: "User is not in this conference" }, { status: 404 });
        }

        if (userConference.role === "VIEWER") {
            return NextResponse.json({ message: "Viewers cannot be presenter" }, { status: 400 });
        }

        // Prüfe maximale Anzahl von WebRTC-Teilnehmern, wenn ein externer Präsentator gesetzt wird
        const isExternalPresenter = userId !== conf.organizerId;
        if (isExternalPresenter) {
            // Hole alle Teilnehmer
            const allParticipants = await prisma.userConference.findMany({
                where: { conferenceId: conf.id },
                select: {
                    userId: true,
                    role: true,
                    isPresenter: true,
                },
            });

            // Zähle aktuelle WebRTC-Teilnehmer (ohne den neuen Präsentator)
            let webrtcCount = 0;
            for (const p of allParticipants) {
                // Organizer ist immer WebRTC-Teilnehmer (wenn nicht VIEWER)
                if (p.userId === conf.organizerId && p.role !== "VIEWER") {
                    webrtcCount++;
                }
                // Fragesteller ist WebRTC-Teilnehmer
                if (p.role === "QUESTIONER") {
                    webrtcCount++;
                }
            }

            // Mit externem Präsentator: max 3 (Organizer + Präsentator + Fragesteller)
            // Aktuell haben wir: Organizer (1) + evtl. Fragesteller (1) = webrtcCount
            // Mit neuem Präsentator: webrtcCount + 1 (Präsentator)
            // Maximum ist 3, also: webrtcCount + 1 <= 3, also webrtcCount <= 2
            if (webrtcCount > 2) {
                return NextResponse.json(
                    {
                        message: "Cannot set external presenter: Maximum number of WebRTC participants would be exceeded (max 3: Organizer + Presenter + Questioner). Please deactivate a questioner first.",
                        currentCount: webrtcCount,
                        maxWithExternalPresenter: 3
                    },
                    { status: 400 }
                );
            }
        }

        await prisma.userConference.updateMany({
            where: {
                conferenceId: conf.id,
                isPresenter: true,
            },
            data: {
                isPresenter: false,
            },
        });

        await prisma.userConference.update({
            where: {
                userId_conferenceId: { userId, conferenceId: conf.id },
            },
            data: {
                isPresenter: true,
            },
        });

        // WebSocket-Event wird vom Client gesendet (siehe Frontend)
        return NextResponse.json({ message: "Presenter set", userId, conferenceId: conf.id, link }, { status: 200 });
    } catch (err) {
        console.error("Set presenter error:", err);
        return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
    }
}

// DELETE: Präsentator entfernen
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ link: string }> }
) {
    try {
        const organizerId = getUserIdFromAuthHeader(req.headers.get("authorization"));
        if (!organizerId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const { link } = await params;

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

        // Entferne isPresenter von allen Usern in dieser Konferenz
        await prisma.userConference.updateMany({
            where: {
                conferenceId: conf.id,
                isPresenter: true,
            },
            data: {
                isPresenter: false,
            },
        });

        // WebSocket-Event wird vom Client gesendet (siehe Frontend)
        return NextResponse.json({ message: "Presenter removed", conferenceId: conf.id, link }, { status: 200 });
    } catch (err) {
        console.error("Remove presenter error:", err);
        return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
    }
}

