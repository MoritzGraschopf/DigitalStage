import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {getUserIdFromAuthHeader} from "@/lib/auth";

export async function GET(
    req: NextRequest,
    {
        params
    }: {
        params: Promise<{link: string}>
    }
){
    try{
        const userId =  getUserIdFromAuthHeader(req.headers.get('authorization'));
        if(!userId)
            return NextResponse.json({message: 'Unauthorized'}, {status: 401});

        const {link} = await params;
        if(!link){
            return NextResponse.json({message: 'Invalid conference link'}, {status: 400})
        }

        const conference = await prisma.conference.findUnique({
            where: { link },
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                startAt: true,
                endDate: true,
                link: true,
                organizerId: true,
                chatMessages: {
                    orderBy: { id: 'asc' },
                    select: {
                        id: true,
                        message: true,
                        userId: true,
                        conferenceId: true,
                        user: {
                            select: { id: true, firstName: true, lastName:true, email: true }
                        }
                    }
                },
                participants: {
                    select: {
                        role: true,
                        userId: true,
                        isPresenter: true,
                        user: { select: { id: true, firstName: true, lastName: true, email: true } }
                    }
                }
            }
        });

        if(!conference){
            return NextResponse.json({message: 'conference not found'}, {status: 404})
        }

        return NextResponse.json(conference, {status: 200})
    }
    catch(err){
        return NextResponse.json({message: 'Internal server error', err}, {status: 500});
    }
}

export async function DELETE(
    req: NextRequest,
    {
        params
    }: {
        params: Promise<{link: string}>
    }
){
    try{
        const userId = getUserIdFromAuthHeader(req.headers.get('authorization'));
        if(!userId){
            return NextResponse.json({message: 'Unauthorized'}, {status: 401});
        }

        const {link} = await params;
        if(!link){
            return NextResponse.json({message: 'Invalid conference link'}, {status: 400});
        }

        const conference = await prisma.conference.findUnique({
            where: {link},
            select: {id: true, organizerId: true}
        });

        if(!conference){
            return NextResponse.json({message: 'Not found'}, {status: 404});
        }

        if(conference.organizerId !== userId){
            return NextResponse.json({message: 'forbitten'}, {status: 403})
        }

        await prisma.conference.delete({where: {link}});

        return NextResponse.json({message: 'Deleted successfully'}, {status: 200})
    }
    catch(err){
        console.error('DELETE /api/conference/[link] error', err);
        return NextResponse.json({message: 'Internal server error'}, {status: 500});
    }
}