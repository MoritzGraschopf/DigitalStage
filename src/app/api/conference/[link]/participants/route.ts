// app/api/conference/[link]/participants/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromAuthHeader } from "@/lib/auth";

const MAX_PARTICIPANTS = 11; // inkl. Organizer

export async function POST(
    req: NextRequest,
    { params }: { params: { link: string } }
) {
    try {
        const organizerId = getUserIdFromAuthHeader(req.headers.get("authorization"));
        if (!organizerId) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({} as never));

        // Abwärtskompatibel: userId (string) ODER userIds (string[])
        let incomingIds: string[] = [];
        if (Array.isArray(body?.userIds)) {
            incomingIds = body.userIds;
        } else if (typeof body?.userId === "string") {
            incomingIds = [body.userId];
        }

        // Normalisieren & validieren (nur non-empty strings)
        const userIds = Array.from(
            new Set(
                incomingIds
                    .filter((v): v is string => typeof v === "string")
                    .map((v) => v.trim())
                    .filter((v) => v.length > 0)
            )
        );

        if (userIds.length === 0) {
            return NextResponse.json(
                { message: "userIds (string[]) oder userId (string) ist erforderlich" },
                { status: 400 }
            );
        }

        const { link } = params;

        const conf = await prisma.conference.findUnique({
            where: { link },
            select: { id: true, organizerId: true },
        });

        if (!conf) return NextResponse.json({ message: "Conference not found" }, { status: 404 });
        if (conf.organizerId !== organizerId) {
            return NextResponse.json({ message: "Forbidden, organizer only" }, { status: 403 });
        }

        // Aktuelle Anzahl (Organizer & Participants)
        const currentCount = await prisma.userConference.count({
            where: { conferenceId: conf.id, role: { in: ["PARTICIPANT", "ORGANIZER"] } },
        });

        // Existierende User?
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, firstName: true, lastName: true },
        });
        const existingUserIdSet = new Set(users.map((u) => u.id));

        // Bereits in der Konferenz?
        const existingRelations = await prisma.userConference.findMany({
            where: { conferenceId: conf.id, userId: { in: userIds } },
            select: { userId: true, role: true },
        });
        const alreadyParticipantOrOrganizer = new Set(
            existingRelations
                .filter((r) => r.role === "PARTICIPANT" || r.role === "ORGANIZER")
                .map((r) => r.userId)
        );

        const slotsLeft = Math.max(0, MAX_PARTICIPANTS - currentCount);

        type SkipReason = "not_found" | "is_organizer" | "already_participant" | "limit_reached";

        const skipped: { userId: string; reason: SkipReason }[] = [];
        const candidates: string[] = [];

        for (const uid of userIds) {
            if (!existingUserIdSet.has(uid)) {
                skipped.push({ userId: uid, reason: "not_found" });
                continue;
            }
            if (uid === organizerId) {
                skipped.push({ userId: uid, reason: "is_organizer" });
                continue;
            }
            if (alreadyParticipantOrOrganizer.has(uid)) {
                skipped.push({ userId: uid, reason: "already_participant" });
                continue;
            }
            candidates.push(uid);
        }

        const toAdd = candidates.slice(0, slotsLeft);
        for (const uid of candidates.slice(slotsLeft)) {
            skipped.push({ userId: uid, reason: "limit_reached" });
        }

        let added: Array<{
            userId: string;
            conferenceId: string;
            role: "PARTICIPANT" | "ORGANIZER" | "VIEWER";
            user: { id: string; email: string | null; firstName: string | null; lastName: string | null };
        }> = [];

        if (toAdd.length > 0) {
            added = await prisma.$transaction(
                toAdd.map((userId) =>
                    prisma.userConference.upsert({
                        where: { userId_conferenceId: { userId, conferenceId: conf.id } },
                        update: { role: "PARTICIPANT" },
                        create: { userId, conferenceId: conf.id, role: "PARTICIPANT" },
                        select: {
                            userId: true,
                            conferenceId: true,
                            role: true,
                            user: { select: { id: true, email: true, firstName: true, lastName: true } },
                        },
                    })
                )
            );
        }

        return NextResponse.json(
            {
                conferenceId: conf.id,
                addedCount: added.length,
                skippedCount: skipped.length,
                added,
                skipped,
            },
            { status: added.length > 0 ? 201 : 200 }
        );
    } catch (err) {
        console.error(err);
        return NextResponse.json(
            { message: "error occurred while adding participants", err: String(err) },
            { status: 500 }
        );
    }
}
