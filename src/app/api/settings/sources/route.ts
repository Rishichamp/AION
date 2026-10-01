import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdminAuthorized } from "@/lib/admin-auth";

// Source enable/disable affects ingestion for EVERY user (Source is a
// shared, global table) — this is an operator/admin operation, not a
// per-user preference, and was previously reachable by any visitor. See
// the read-only Source Health note in Settings and /status.
const bodySchema = z.object({
  category: z.enum(["research", "news", "models", "opensource"]),
  enabled: z.boolean()
});

export async function GET(req: Request) {
  if (!isAdminAuthorized({ bearer: req.headers.get("authorization") })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sources = await db.source.findMany({ orderBy: { category: "asc" } });
  return NextResponse.json({ sources });
}

export async function PUT(req: Request) {
  if (!isAdminAuthorized({ bearer: req.headers.get("authorization") })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await db.source.updateMany({ where: { category: parsed.data.category }, data: { enabled: parsed.data.enabled } });
  return NextResponse.json({ ok: true });
}
