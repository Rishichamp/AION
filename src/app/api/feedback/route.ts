import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeContentKey } from "@/lib/bookmarks/contentKey";
import { setFeedback, clearFeedback } from "@/lib/personalize/feedback";

// Exactly one content ref, mirroring /api/bookmarks — see that route's
// comment for why a bare object spread into `data` is never safe here.
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

const postSchema = itemRefSchema.and(
  z.object({
    kind: z.enum(["NOT_INTERESTED", "MORE_LIKE_THIS"]),
    reason: z.enum(["off_topic", "seen_it", "too_basic", "wrong_source", "other"]).optional()
  })
);

export async function GET() {
  const user = await getCurrentUser();
  const rows = await db.contentFeedback.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ feedback: rows });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { kind, reason, ...ref } = parsed.data;

  // Snapshot the item's own title/topics/source SERVER-SIDE rather than
  // trusting whatever the client sent — this is what ranking learns from,
  // so it must reflect the actual content, not client-supplied text.
  const snapshot = await lookupSnapshot(ref);
  if (!snapshot) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  await setFeedback(user.id, ref, kind, reason, snapshot);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  const parsed = itemRefSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await clearFeedback(user.id, parsed.data);
  return NextResponse.json({ ok: true });
}

async function lookupSnapshot(ref: z.infer<typeof itemRefSchema>) {
  if (ref.articleId) {
    const a = await db.article.findUnique({ where: { id: ref.articleId }, include: { topics: true, source: true } });
    return a && { title: a.title, topicNames: a.topics.map((t: any) => t.name), sourceName: a.source?.name };
  }
  if (ref.paperId) {
    const p = await db.researchPaper.findUnique({ where: { id: ref.paperId }, include: { topics: true, source: true } });
    return p && { title: p.title, topicNames: p.topics.map((t: any) => t.name), sourceName: p.source?.name };
  }
  if (ref.modelId) {
    const m = await db.modelRelease.findUnique({ where: { id: ref.modelId } });
    return m && { title: m.name, topicNames: [] as string[], sourceName: m.organization };
  }
  if (ref.projectId) {
    const p = await db.openSourceProject.findUnique({ where: { id: ref.projectId }, include: { topics: true } });
    return p && { title: p.name, topicNames: p.topics.map((t: any) => t.name), sourceName: p.organization ?? undefined };
  }
  return null;
}
