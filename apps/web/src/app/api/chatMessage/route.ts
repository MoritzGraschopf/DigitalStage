import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';

export async function GET(req: NextRequest) {
    // Extrahiere den Query-Parameter conferenceId
    const { searchParams } = new URL(req.url);
    const conferenceId = searchParams.get("conferenceId");

    // Überprüfe, ob conferenceId vorhanden ist
    if (!conferenceId) {
        return NextResponse.json(
            { message: 'Query parameter "conferenceId" is required' },
            { status: 400 }
        );
    }

    // Überprüfe das Authorization-Header und extrahiere das Token
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Verifiziere das JWT
        const secret = process.env.JWT_SECRET!;
        jwt.verify(token, secret);

        // Lade nur die Nachrichten (`chatMessages`) der Konferenz mit der entsprechenden ID
        const chatMessages = await prisma.chatMessage.findMany({
            where: {
                conferenceId,
            },
            include: {
                user: {
                    select: { id: true, firstName: true, lastName:true, email: true }, // Nur relevante User-Daten einfügen
                },
            },
        });

        return NextResponse.json({
            chatMessages,
        }, { status: 200 });
    } catch (err) {
        console.error('GET /chatMessages error:', err);
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    // Extract 'conferenceId' from query parameters
    const { searchParams } = new URL(req.url);
    const conferenceId = searchParams.get("conferenceId");

    // Return error if 'conferenceId' is missing
    if (!conferenceId) {
        return NextResponse.json(
            { message: 'Query parameter "conferenceId" is required' },
            { status: 400 }
        );
    }

    // Extract and verify the 'Authorization' header
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Decode and verify the JWT using the secret
        const secret = process.env.JWT_SECRET!;
        const decodedToken = jwt.verify(token, secret) as { userId: string };

        // Get the request body to extract chat message
        const body = await req.json();
        const { message } = body; // Assuming 'messageContent' is passed in the request body

        // Check if 'messageContent' is provided
        if (!message) {
            return NextResponse.json(
                { message: 'Message content is required' },
                { status: 400 }
            );
        }

        // Save the new chat message in the database
        const chatMessage = await prisma.chatMessage.create({
            data: {
                message: message,
                conferenceId,
                userId: decodedToken.userId, // User ID from the decoded JWT
            }
        });

        return NextResponse.json({
            message: 'Chat message created successfully',
            chatMessage,
        }, { status: 201 });
    } catch (err) {
        console.error('POST /chatMessages error:', err);
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
}