import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
    try {
        const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
        if (q.length < 2) return NextResponse.json([]);

        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { firstName: { contains: q, mode: "insensitive" } },
                    { lastName: { contains: q, mode: "insensitive" } },
                ],
            },
            take: 20,
            select: { id: true, firstName: true, lastName: true },
        });

        return NextResponse.json(users);
    } catch (err) {
        console.error("[GET /api/user/search]", err);
        return NextResponse.json({ error: "Failed to search users" }, { status: 500 });
    }
}

