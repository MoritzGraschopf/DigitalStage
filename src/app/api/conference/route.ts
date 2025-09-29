import {NextRequest, NextResponse} from "next/server";
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { getUserIdFromAuthHeader } from '@/lib/auth';

export async function GET(){
    const conferences = await prisma.conference.findMany({
        select: {
            id: true, title: true, description: true,
            status:true, startAt: true, endDate: true, link: true
        },
        orderBy: {
            id: 'desc'
        }
    });
    return NextResponse.json({conferences});
}

export async function POST(req: NextRequest){
    try{
        const organizerId = getUserIdFromAuthHeader(req.headers.get('authorization'));
        if(!organizerId){
            return NextResponse.json({message: "Unauthorized"}, {status: 401});
        }

        const body = await req.json();
        const {
            title,
            description,
            startAt,
            endDate,
            userIds = []
        } = body ?? {};

        if(!title || typeof title !== 'string'){
            return NextResponse.json({message: 'Title is required'}, {status: 400});
        }

        const link = randomUUID();

        const conference = await prisma.conference.create({
            data: {
                title,
                description: description ?? null,
                startAt: startAt ? new Date(startAt) : null,
                endDate: endDate ? new Date(endDate) : null,
                status: 'SCHEDULED',
                link,
                organizerId,
                participants: {
                    create: [
                        {userId: organizerId, role: 'ORGANIZER'},
                        ...userIds.map((uid: number) => ({userId: uid, role: 'PARTICIPANT'}))
                    ]
                }
            },
            select: {
                id: true, title: true, description: true, status: true,
                startAt: true, endDate: true, link: true, organizerId: true,
                participants: {
                    select: {
                        role: true,
                        userId: true,
                    }
                }
            }
        });

        return NextResponse.json({conference}, {status: 201});
    }
    catch(err){
        console.error('POST /api/conference error', err);
        return NextResponse.json({message: 'Internal Server Error'}, {status: 500});
    }
}