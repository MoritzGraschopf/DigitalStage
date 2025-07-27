import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import jwt from 'jsonwebtoken';

export async function GET(
    req: NextRequest,
    {params}: { params: Promise<{ link: string }> }
) {
    const {link} = await params;
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return NextResponse.json({message: 'Unauthorized'}, {status: 401});
    }

    try {
        const secret = process.env.JWT_SECRET!;
        jwt.verify(token, secret)

        if (!link) {
            return NextResponse.json({message: 'Invalid conference link'}, {status: 400});
        }

        const conference = await prisma.conference.findUnique({
            where: {link}, // Query conference using link
            include: {
                chatMessages: true,
            }
        });

        return NextResponse.json(conference);
    } catch (err) {
        console.error('GET /conference error:', err);
        return NextResponse.json({message: 'Internal server error'}, {status: 500});
    }
}

export async function DELETE(
    req: NextRequest,
    {params}: { params: Promise<{ link: string }> } // Update to use "link" instead of "id"
) {
    const {link} = await params; // Extract "link"
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return NextResponse.json({message: 'Unauthorized'}, {status: 401});
    }

    try {
        const secret = process.env.JWT_SECRET!;
        const payload = jwt.verify(token, secret) as { userId: number };

        if (!link) {
            return NextResponse.json({message: 'Invalid conference link'}, {status: 400});
        }

        const conference = await prisma.conference.findUnique({
            where: {link}, // Query conference using link
        });

        if (!conference || conference.userId !== payload.userId) {
            return NextResponse.json({message: 'Not found or not authorized'}, {status: 404});
        }

        await prisma.conference.delete({
            where: {link}, // Delete conference using link
        });

        return NextResponse.json({message: 'Deleted successfully'}, {status: 200});
    } catch (err) {
        console.error('DELETE /conference/:link error', err);
        return NextResponse.json({message: 'Error deleting conference'}, {status: 500});
    }
}
