// app/api/account/settings/route.ts
import {NextRequest, NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getUserIdFromAuthHeader} from "@/lib/auth";
import {z} from "zod";

const SettingsSchema = z.object({
    locale: z.string().min(2).optional(),
    timezone: z.string().min(1).optional(),
    autoplayHls: z.boolean().optional(),
    notifyChatToasts: z.boolean().optional(),
    notifyConfCreated: z.boolean().optional(),
    wsReconnect: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
    const uid = getUserIdFromAuthHeader(req.headers.get("authorization"));
    if (!uid) return NextResponse.json({message:"Unauthorized"}, {status:401});

    // Settings anlegen falls nicht existent (idempotent)
    const settings = await prisma.userSettings.upsert({
        where: { userId: uid },
        create: { userId: uid },
        update: {},
    });
    return NextResponse.json({settings});
}

export async function PUT(req: NextRequest) {
    const uid = getUserIdFromAuthHeader(req.headers.get("authorization"));
    if (!uid) return NextResponse.json({message:"Unauthorized"}, {status:401});

    const json = await req.json().catch(() => ({}));
    const parsed = SettingsSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json({message:"Invalid payload", issues: parsed.error.flatten()}, {status:400});
    }

    const settings = await prisma.userSettings.update({
        where: { userId: uid },
        data: parsed.data,
    });
    return NextResponse.json({settings});
}
