import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
    try {
        const { ids } = await req.json().catch(() => ({ ids: [] }));
        const unique = Array.isArray(ids)
            ? Array.from(new Set(ids)).filter((x) => typeof x === "string").slice(0, 200)
            : [];

        const users = await prisma.user.findMany({
            where: { id: { in: unique } },
            select: { id: true, firstName: true, lastName: true },
        });

        return NextResponse.json(users);
    } catch (err) {
        console.error("[POST /api/user/batch]", err);
        return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
    }
}

