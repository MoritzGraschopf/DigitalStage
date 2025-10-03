import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromAuthHeader } from "@/lib/auth";

export async function POST(
    req: NextRequest,
    {params}: {params: Promise<{link: string}>}
){
    try{
        const {link} = await params;
        const organizerId = getUserIdFromAuthHeader(req.headers.get("authorization"));
        if(!organizerId)
            return NextResponse.json({message: 'Unauthorized'}, {status: 401});

        const {userId} = await req.json();
        if(!userId)
            return NextResponse.json({message: 'UserId is required (number)'}, {status: 400});

        const conf = await prisma.conference.findUnique({
            where: {link: link},
            select: {id: true, organizerId: true}
        });

        if(!conf)
            return NextResponse.json({message: 'Conference not found'}, {status: 404});

        if(conf.organizerId !== organizerId)
            return NextResponse.json({message: 'Forbidden, organizer only'}, {status: 403});

        const user = await prisma.user.findUnique({
            where: {id: userId},
            select: {id: true}
        });

        if(!user)
            return NextResponse.json({message: 'User does not exist'}, {status: 404});

        if(userId === organizerId)
            return NextResponse.json({message: 'Organizer is already a participant'}, {status: 409});

        const count = await prisma.userConference.count({
            where: { conferenceId: conf.id, role: { in: ["PARTICIPANT", "ORGANIZER"] } },
        });
        if(count >= 11)
            return NextResponse.json({message: "Participant-limit reached"}, {status: 409});

        const existing = await prisma.userConference.findUnique({
            where: { userId_conferenceId: { userId, conferenceId: conf.id } },
            select: { role: true },
        });
        if (existing?.role === "PARTICIPANT" || existing?.role === "ORGANIZER") {
            return NextResponse.json({ message: "User already a participant" }, { status: 409 });
        }

        const participation = await prisma.userConference.upsert({
            where: { userId_conferenceId: { userId, conferenceId: conf.id } },
            update: { role: "PARTICIPANT" },
            create: { userId, conferenceId: conf.id, role: "PARTICIPANT" },
            select: {
                userId: true,
                conferenceId: true,
                role: true,
                user: { select: { id: true, email: true, firstName: true, lastName: true } },
            },
        });

        return NextResponse.json({participation}, {status: 201});
    }
    catch(err){
        return NextResponse.json({message: 'error occurred while retrieving user',err}, {status: 500});
    }
}