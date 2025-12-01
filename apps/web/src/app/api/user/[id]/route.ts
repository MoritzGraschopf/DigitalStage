import {NextRequest, NextResponse} from "next/server";
import {getUserIdFromAuthHeader} from "@/lib/auth";
import {prisma} from "@/lib/prisma";

export async function GET(
    req: NextRequest,
    {
        params
    }: {
        params: Promise<{id: string}>
    }
){
    try{
        const userId =  getUserIdFromAuthHeader(req.headers.get('authorization'));
        if(!userId)
            return NextResponse.json({message: 'Unauthorized'}, {status: 401});

        const {id} = await params;
        if(!id){
            return NextResponse.json({message: 'Invalid User Id'}, {status: 400})
        }

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
            }
        })

        if(!user){
            return NextResponse.json({message: 'user not found'}, {status: 404})
        }

        return NextResponse.json(user, {status: 200})
    }
    catch(err){
        return NextResponse.json({message: 'Internal server error', err}, {status: 500});
    }
}
