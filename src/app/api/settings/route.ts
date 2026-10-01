import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const bodySchema = z.object({
  interests: z.array(z.object({ topic: z.string().min(1).max(64), weight: z.number().min(0).max(1).optional() })).optional(),
  notifPrefs: z
    .object({
      dailyBriefEnabled: z.boolean().optional(),
      dailyBriefTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      importantAlerts: z.boolean().optional()
    })
    .optional(),
  // IANA timezone name, e.g. "America/New_York" — used for per-user daily
  // notification scheduling (see /api/push/send).
  timezone: z.string().min(1).max(64).optional(),
  focus: z
    .object({
      request: z.string().max(500).optional(),
      mutedKeywords: z.array(z.string().min(1).max(40)).max(30).optional(),
      mutedSources: z.array(z.string().min(1).max(80)).max(30).optional()
    })
    .optional()
});

export async function GET() {
  const user = await getCurrentUser();
  const [interests, notifPrefs, focus] = await Promise.all([
    db.userInterest.findMany({ where: { userId: user.id } }),
    db.notificationPreference.findUnique({ where: { userId: user.id } }),
    db.userFocus.findUnique({ where: { userId: user.id } })
  ]);
  return NextResponse.json({ interests, notifPrefs, timezone: user.timezone, focus });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  if (body.interests) {
    await db.userInterest.deleteMany({ where: { userId: user.id } });
    await db.userInterest.createMany({
      data: body.interests.map((i) => ({ userId: user.id, topic: i.topic, weight: i.weight ?? 1.0 }))
    });
  }

  if (body.notifPrefs) {
    await db.notificationPreference.upsert({
      where: { userId: user.id },
      update: body.notifPrefs,
      create: { ...body.notifPrefs, userId: user.id } // userId last — never let the body override it
    });
  }

  if (body.timezone) {
    await db.user.update({ where: { id: user.id }, data: { timezone: body.timezone } });
  }

  if (body.focus) {
    await db.userFocus.upsert({
      where: { userId: user.id },
      update: body.focus,
      create: { userId: user.id, request: "", mutedKeywords: [], mutedSources: [], ...body.focus }
    });
  }

  return NextResponse.json({ ok: true });
}
