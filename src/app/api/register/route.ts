import {NextRequest, NextResponse} from 'next/server';
import bcrypt from "bcryptjs";
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest){
    const body = await req.json();
    const {email, password} = body;

    if(!email || !password){
        return NextResponse.json({message: 'Email and password required'}, {status: 400});
    }

    try {
        const existingUser = await prisma.user.findUnique({where: {email} });
        if(existingUser){
            return NextResponse.json({message: 'User already exists'}, {status: 409});
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.create({
            data: {
                email,
                passwordHash: hashedPassword,
            },
        });

        return NextResponse.json({message: "User created successfully"}, {status: 201});
    }
    catch(err){
        console.log("Error: ", err);
        return NextResponse.json({status: 500});
    }
}