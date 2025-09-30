import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';

function getUserFromAuth(req: NextRequest) {
    const token = req.headers.get('authorization')?.split(' ')[1];
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; email: string };
}

export async function POST(
    req: NextRequest,
    {params}: {params: {link: string}}
){
    try{
        const auth = getUserFromAuth(req);
        if(!auth)
            return NextResponse.json({message: 'Unauthorized'}, {status: 401});

        const {role} = await req.json().catch(() => ({}));
        if(!role)
            return NextResponse.json({message: 'Role is required'}, {status: 400});

        const conf = await prisma.conference.findUnique({
            where: {link: params.link},
            select: {id: true, organizerId: true},
        });

        if(!conf)
            return NextResponse.json({message: 'conference not found'}, {status: 404});

        if(role === 'ORGANIZER'){
            if(conf.organizerId != auth.userId)
                return NextResponse.json({message: 'Forbidden, not the organizer'}, {status: 403});
            const participation = await prisma.userConference.upsert({
                where: { userId_conferenceId: { userId: auth.userId, conferenceId: conf.id } },
                update: { role: 'ORGANIZER' },
                create: { userId: auth.userId, conferenceId: conf.id, role: 'ORGANIZER' },
                select: { userId: true, conferenceId: true, role: true },
            });
            return NextResponse.json({ message: 'Joined as organizer', participation });
        }

        if (role === 'PARTICIPANT') {
            const existing = await prisma.userConference.findUnique({
                where: { userId_conferenceId: { userId: auth.userId, conferenceId: conf.id } },
                select: { role: true },
            });
            if (!existing || (existing.role !== 'PARTICIPANT' && existing.role !== 'ORGANIZER')) {
                return NextResponse.json({ message: 'Not invited as participant' }, { status: 403 });
            }
            const participation = await prisma.userConference.upsert({
                where: { userId_conferenceId: { userId: auth.userId, conferenceId: conf.id } },
                update: { role: 'PARTICIPANT' },
                create: { userId: auth.userId, conferenceId: conf.id, role: 'PARTICIPANT' },
                select: { userId: true, conferenceId: true, role: true },
            });
            return NextResponse.json({ message: 'Joined as participant', participation });
        }

        if(role === 'VIEWER'){
            const participation = await prisma.userConference.upsert({
                where: {userId_conferenceId: {userId: auth.userId, conferenceId: conf.id}},
                update: {role: 'VIEWER'},
                create: {userId: auth.userId, conferenceId: conf.id, role: 'VIEWER'},
                select: {userId: true, conferenceId: true, role: true },
            });
            return NextResponse.json({message: 'Joined as viewer', participation})
        }

        return NextResponse.json({message: 'Invalid role'}, {status: 400});
    }
    catch (err){
        return NextResponse.json({message: 'Unable to connect to the server', err}, {status: 500});
    }
}