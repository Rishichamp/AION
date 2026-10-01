import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

// body: the PushSubscription object from the browser's Push API (JSON.stringify(sub))
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const sub = await req.json();
  const keys = sub?.keys ?? {};
  if (!sub?.endpoint || !keys.p256dh || !keys.auth) {
    return NextResponse.json({ error: "Invalid subscription payload" }, { status: 400 });
  }

  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth, userId: user.id },
    create: { userId: user.id, endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  const { endpoint } = await req.json();
  if (typeof endpoint !== "string") return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return NextResponse.json({ ok: true });
}
