import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromAuthHeader } from "@/lib/auth";

export async function DELETE(
    req: NextRequest,
    {params}: {params: Promise<{link: string; userId: string}>}
){
    try{
        const organizerId = getUserIdFromAuthHeader(req.headers.get('authorization'));
        if(!organizerId)
            return NextResponse.json({message: 'Unauthorized'}, {status: 401});

        const {link, userId} = await params;

        const conf = await prisma.conference.findUnique({
            where: {link},
            select: {id: true, organizerId: true}
        });

        if(!conf)
            return NextResponse.json({message: 'Conference not found'}, {status: 404});
        if(conf.organizerId !== organizerId)
            return NextResponse.json({message: 'Forbidden (organizer only)'}, {status: 403});

        if(userId === organizerId)
            return NextResponse.json({message: 'Cannot remove organizer'}, {status: 400});

        const existing = await prisma.userConference.findUnique({
           where: {userId_conferenceId: {userId, conferenceId: conf.id}},
           select: {userId: true, role: true}
        });

        if(!existing)
            return NextResponse.json({message: 'Participation not found'});

        await prisma.userConference.update({
            where: {userId_conferenceId: {userId, conferenceId: conf.id}},
            data: {role: 'VIEWER'}
        });

        return NextResponse.json({message: 'Removed from participants (set to viewer)'}, {status: 200});
    }
    catch(err){
        return NextResponse.json({message: 'Internal Server Error', err}, {status: 500});
    }
}