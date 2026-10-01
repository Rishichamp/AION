import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeContentKey } from "@/lib/bookmarks/contentKey";

// Exactly one of these four — never a bare object spread into `data`, which
// previously let a malicious body silently override `userId` (see git
// history) and create/delete bookmarks on another user's behalf.
const itemRefSchema = z
  .object({
    articleId: z.string().cuid().optional(),
    paperId: z.string().cuid().optional(),
    modelId: z.string().cuid().optional(),
    projectId: z.string().cuid().optional()
  })
  .refine((v) => [v.articleId, v.paperId, v.modelId, v.projectId].filter(Boolean).length === 1, {
    message: "Exactly one of articleId/paperId/modelId/projectId is required"
  });

const deleteSchema = z.union([z.object({ id: z.string().cuid() }), itemRefSchema]);

export async function GET() {
  const user = await getCurrentUser();
  const bookmarks = await db.bookmark.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { article: true, paper: true, model: true, project: true }
  });
  return NextResponse.json({ bookmarks });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const parsed = itemRefSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Genuine DB-level idempotency: two concurrent requests (two tabs, two
  // devices) racing to save the same item both resolve to the SAME row via
  // the (userId, contentKey) unique constraint — upsert makes this safe to
  // retry, unlike the previous plain `create` which could either duplicate
  // under a lost check-then-insert race or throw on a legitimate retry.
  const contentKey = computeContentKey(parsed.data);
  const bookmark = await db.bookmark.upsert({
    where: { userId_contentKey: { userId: user.id, contentKey } },
    update: {},
    create: { ...parsed.data, userId: user.id, contentKey }
  });
  return NextResponse.json({ bookmark });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if ("id" in parsed.data) {
    await db.bookmark.deleteMany({ where: { id: parsed.data.id, userId: user.id } });
  } else {
    // deleteMany on the same unique key as POST's upsert — safely
    // repeatable: a second identical DELETE just matches zero rows instead
    // of erroring.
    const contentKey = computeContentKey(parsed.data);
    await db.bookmark.deleteMany({ where: { userId: user.id, contentKey } });
  }
  return NextResponse.json({ ok: true });
}
