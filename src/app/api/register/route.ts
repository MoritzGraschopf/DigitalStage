import {NextRequest, NextResponse} from 'next/server';
import bcrypt from "bcryptjs";
import { prisma } from '@/lib/prisma';
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest){
    const body = await req.json();
    const {email, password, name} = body;

    if (!email || !password || !name) {
        return NextResponse.json({ message: 'Name, email, and password are required' }, { status: 400 });
    }

    try {
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return NextResponse.json({ message: 'User already exists' }, { status: 409 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                passwordHash: hashedPassword,
            },
        });

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error("JWT secret must be defined in the environment variables.");
        }

        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            secret,
            { expiresIn: '1h' } // Token expiration time
        );

        // Return success response with token
        return NextResponse.json(
            { message: "User created successfully", token },
            { status: 201 }
        );

    } catch (err) {
        console.error("Error: ", err);
        return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
}