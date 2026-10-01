import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateRadarBriefing, RadarInProgressError, RadarGenerationError } from "@/lib/radar/generate";
import { db } from "@/lib/db";

// GET: run (or re-run) the "since I last checked" radar for the current user.
export async function GET() {
  const user = await getCurrentUser();
  try {
    const brief = await generateRadarBriefing(user.id);
    return NextResponse.json({ brief });
  } catch (err) {
    if (err instanceof RadarInProgressError) {
      return NextResponse.json({ error: err.message, status: "in_progress" }, { status: 202 });
    }
    if (err instanceof RadarGenerationError) {
      // Nothing was persisted and the checkpoint didn't advance — the
      // person's previous Radar (if any) is completely unaffected. Never
      // silently show "nothing changed" here; that would misrepresent a
      // synthesis failure as a genuine quiet period.
      console.error("[/api/radar] generation failed:", err.message);
      return NextResponse.json(
        { error: "AION couldn't put together a Radar update right now. Your previous Radar is still available." },
        { status: 500 }
      );
    }
    console.error("[/api/radar] failed:", err);
    return NextResponse.json({ error: "Failed to generate radar briefing" }, { status: 500 });
  }
}

// PATCH: mark a radar item as read.
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  const { itemId } = await req.json();
  if (typeof itemId !== "string") return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const item = await db.radarItem.findUnique({ where: { id: itemId }, include: { brief: true } });
  if (!item || item.brief.userId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const contentRef = {
    articleId: item.articleId ?? undefined,
    paperId: item.paperId ?? undefined,
    modelId: item.modelId ?? undefined,
    projectId: item.projectId ?? undefined
  };

  // Idempotent: a Postgres unique constraint across these nullable FK
  // columns wouldn't actually work (NULLs are never equal to each other in
  // a unique index), so this is enforced at the application level instead.
  // Without this, opening the same paper five times created five
  // UserReadHistory rows and inflated the behavioral ranking signal
  // (see lib/radar/behavior.ts) as if the user had read five different
  // things.
  const existing = await db.userReadHistory.findFirst({ where: { userId: user.id, ...contentRef } });
  if (!existing) {
    await db.userReadHistory.create({ data: { userId: user.id, ...contentRef } });
  }
  return NextResponse.json({ ok: true });
}
