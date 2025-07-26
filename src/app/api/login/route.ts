import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
        return NextResponse.json({ message: 'Email and password are required' }, { status: 400 });
    }

    try {
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return NextResponse.json({ message: 'User not found' }, { status: 401 });
        }

        const passwordMatch = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatch) {
            return NextResponse.json({ message: 'Password not match' }, { status: 401 });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            return NextResponse.json({ message: 'JWT secret missing' }, { status: 500 });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            secret,
            { expiresIn: '1h' }
        );

        return NextResponse.json({ token }, { status: 200 });
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
