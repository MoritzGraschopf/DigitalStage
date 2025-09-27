import {NextRequest, NextResponse} from "next/server";
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { getUserIdFromAuthHeader } from '@/lib/auth';

export async function GET(){
    const conferences = await prisma.conference.findMany({
        select: {
            id: true, title: true, description: true,
            status:true, startDate: true, endDate: true, link: true
        },
        orderBy: {
            id: 'desc'
        }
    });
    return NextResponse.json({conferences});
}

export async function POST(req: NextRequest){
    try{
        const userId = getUserIdFromAuthHeader(req.headers.get('authorization'));
        if(!userId){
            return NextResponse.json({message: "Unauthorized"}, {status: 401});
        }

        const body = await req.json();
        const {
            title,
            description,
            startDate,
            endDate,
            participationPassword
        } = body ?? {};

        if(!title || typeof title !== 'string'){
            return NextResponse.json({message: 'Title is required'}, {status: 400});
        }

        let participationPasswordHash: string | null = null;
        if(participationPassword){
            participationPasswordHash = await bcrypt.hash(participationPassword, 10);
        }

        const link = randomUUID();

        const conference = await prisma.conference.create({
            data: {
                title,
                description: description ?? null,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                status: 'SCHEDULED',
                link,
                participationPassword: participationPasswordHash,
                userId // Owner
            },
            select: {
                id: true, title: true, description: true, status: true,
                startDate: true, endDate: true, link: true, userId: true
            }
        });

        await prisma.userConference.upsert({
            where: {
                userId_conferenceId: { userId, conferenceId: conference.id }
            },
            update: {role: 'ORGANIZER'},
            create: {
                userId,
                conferenceId: conference.id,
                role: 'ORGANIZER'
            }
        });

        return NextResponse.json({conference}, {status: 201});
    }
    catch(err){
        console.error('POST /api/conference error', err);
        return NextResponse.json({message: 'Internal Server Error'}, {status: 500});
    }
}