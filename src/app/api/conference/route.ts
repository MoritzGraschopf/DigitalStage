import {NextRequest, NextResponse} from 'next/server';
import { prisma } from '@/lib/prisma'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return NextResponse.json({message: 'Unauthorized'}, {status: 401});
    }

    try {
        const conferences = await prisma.conference.findMany({
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                startDate: true,
                endDate: true,
                link: true,
                participationPassword: false, // Hide sensitive fields
            },
            orderBy: {startDate: 'desc'}, // Optionally order by startDate
        });


        return NextResponse.json({conferences}, {status: 200});
    } catch (err) {
        console.error('GET /conference error:', err);
        return NextResponse.json({message: 'Unauthorized or invalid token'}, {status: 401});
    }
}

export async function POST(req: NextRequest){
    try {
        const body = await req.json();
        const { title, description, startDate, endDate, participationPassword } = body;

        const authHeader = req.headers.get("authorization");
        const token = authHeader?.split(' ')[1];

        if(!token || !process.env.JWT_SECRET){
            return NextResponse.json({message: "Unauthorized"}, {status: 401});
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET) as {userId: number};

        const link = randomUUID();

        const conference = await prisma.conference.create({
            data: {
                title,
                description,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                status: 'SCHEDULED',
                link,
                participationPassword,
                userId: decoded.userId,
            }
        });

        return NextResponse.json(conference, {status: 201});
    }
    catch (error){
        console.error("Error creating conference", error);
        return NextResponse.json({message: "Internal Server error"}, {status: 500});
    }
}