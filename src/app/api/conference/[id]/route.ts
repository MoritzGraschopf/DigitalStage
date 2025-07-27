import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';

export async function GET(req: NextRequest){
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if(!token){
        return NextResponse.json({ message: 'Unauthorized' }, {status: 401});
    }

    try {
        const secret = process.env.JWT_SECRET!;
        const payload = jwt.verify(token, secret) as { userId: number };

        const conferences = await prisma.conference.findMany({
            where: { userId: payload.userId },
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                startDate: true,
                endDate: true,
                link: true,
                participationPassword: false,
            },
            orderBy: { startDate: 'desc' },
        });

        return NextResponse.json(conferences);
    } catch (err) {
        console.error('GET /conference error:', err);
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params

    const authHeader = req.headers.get('authorization')
    const token = authHeader?.split(' ')[1]

    if (!token) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    try {
        const secret = process.env.JWT_SECRET!
        const payload = jwt.verify(token, secret) as { userId: number }

        const conferenceId = parseInt(id)
        if (isNaN(conferenceId)) {
            return NextResponse.json({ message: 'Invalid conference ID' }, { status: 400 })
        }

        const conference = await prisma.conference.findUnique({
            where: { id: conferenceId },
        })

        if (!conference || conference.userId !== payload.userId) {
            return NextResponse.json({ message: 'Not found or not authorized' }, { status: 404 })
        }

        await prisma.conference.delete({
            where: { id: conferenceId },
        })

        return NextResponse.json({ message: 'Deleted successfully' }, { status: 200 })
    } catch (err) {
        console.error('DELETE /conference/:id error', err)
        return NextResponse.json({ message: 'Error deleting conference' }, { status: 500 })
    }
}