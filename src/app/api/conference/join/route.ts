import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

function getUserFromAuth(req: NextRequest) {
    const token = req.headers.get('authorization')?.split(' ')[1];
    if (!token) return null;
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number; email: string };
    return payload;
}

export async function POST(
    req: NextRequest,
    {params}: {params: {link: string}}
){
    try {
        const auth = getUserFromAuth(req);
        if (!auth)
            return NextResponse.json({message: 'Unauthorized'}, {status: 401});

        const {link} = params;
        const body = await req.json().catch(() => ({}));
        const requestedRole: 'ORGANIZER' | 'PARTICIPANT' | 'VIEWER' = body?.role;

        if (!requestedRole) {
            return NextResponse.json({message: 'Role is required'}, {status: 400});
        }

        const conference = await prisma.conference.findUnique({
            where: {link},
            select: {
                id: true,
                userId: true, //Should be the owner, instead you might be in trouble
                participationPassword: true,
                status: true,
            },
        });

        if (!conference) {
            return NextResponse.json({message: 'Conference not found'}, {status: 404});
        }

        if (requestedRole === 'ORGANIZER') {
            if (conference.userId !== auth.userId) {
                return NextResponse.json({message: 'Forbitten: not the organizer'}, {status: 403})
            }

            const participation = await prisma.userConference.upsert({
                where: {userId_conferenceId: {userId: auth.userId, conferenceId: conference.id}},
                update: {role: 'ORGANIZER'},
                create: {userId: auth.userId, conferenceId: conference.id, role: 'ORGANIZER'},
                select: {userId: true, conferenceId: true, role: true},
            });

            return NextResponse.json({message: 'Joined as organizer', participation}, {status: 200});
        }

        if (requestedRole === 'PARTICIPANT') {
            const inputPassword: string | undefined = body?.password;

            if (!conference.participationPassword) {
                return NextResponse.json({message: 'Conference has no participant password set'}, {status: 403});
            }
            if (!inputPassword) {
                return NextResponse.json({message: 'Password is required'}, {status: 400});
            }

            const ok = await bcrypt.compare(inputPassword, conference.participationPassword);
            if (!ok) {
                return NextResponse.json({message: 'Invalid password'}, {status: 403});
            }

            const participation = await prisma.userConference.upsert({
                where: {userId_conferenceId: {userId: auth.userId, conferenceId: conference.id}},
                update: {role: 'PARTICIPANT'}, // falls Upgrade Viewer -> Participant
                create: {userId: auth.userId, conferenceId: conference.id, role: 'PARTICIPANT'},
                select: {userId: true, conferenceId: true, role: true},
            });

            return NextResponse.json({message: 'Joined as participant', participation}, {status: 200});
        }

        if (requestedRole === 'VIEWER') {
            const participation = await prisma.userConference.upsert({
                where: {userId_conferenceId: {userId: auth.userId, conferenceId: conference.id}},
                update: {role: 'VIEWER'},
                create: {userId: auth.userId, conferenceId: conference.id, role: 'VIEWER'},
                select: {userId: true, conferenceId: true, role: true},
            });

            return NextResponse.json({message: 'Joined as viewer', participation}, {status: 200});
        }
        return NextResponse.json({message: 'Invalid role'}, {status: 400});
    }
    catch(err){
        console.error('join error', err);
        return NextResponse.json({message: 'Internal Server Error'}, {status: 500});
    }
}