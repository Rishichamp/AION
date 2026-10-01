// DB-touching half of feedback handling — aggregating a user's rows into
// PersonalizationSignals, and writing new feedback. See feedbackTypes.ts
// for the pure types/logic (merging, exclusion-list conventions) that this
// module builds on.
import { db } from "@/lib/db";
import { computeContentKey, type BookmarkItemRef } from "@/lib/bookmarks/contentKey";
import { emptyIdSets, type FeedbackKind, type FeedbackReason, type PersonalizationSignals } from "./feedbackTypes";

export type { FeedbackKind, FeedbackReason, PersonalizationSignals, IdSets } from "./feedbackTypes";
export { applyFeedbackToInterests, excludeClause, emptySignals } from "./feedbackTypes";

// Kept well below an explicit interest (weight 1.0) or the behavioral boost
// cap (0.4, see radar/behavior.ts) — feedback nudges ranking, it doesn't
// override deliberate choices in Settings.
const MAX_TOPIC_ADJUST = 0.5;
const MAX_SOURCE_ADJUST = 0.4;
const PER_ITEM_TOPIC_WEIGHT = 0.15;
const PER_ITEM_SOURCE_WEIGHT = 0.12;

export async function getPersonalizationSignals(userId: string): Promise<PersonalizationSignals> {
  const rows = await db.contentFeedback.findMany({ where: { userId } });

  const hiddenKeys = new Set<string>();
  const hiddenIds = emptyIdSets();
  const byKey = new Map<string, FeedbackKind>();
  const topicRaw = new Map<string, number>();
  const sourceRaw = new Map<string, number>();

  for (const r of rows as any[]) {
    byKey.set(r.contentKey, r.kind);
    const sign = r.kind === "MORE_LIKE_THIS" ? 1 : -1;
    for (const t of r.topicNames as string[]) topicRaw.set(t, (topicRaw.get(t) ?? 0) + sign * PER_ITEM_TOPIC_WEIGHT);
    if (r.sourceName) sourceRaw.set(r.sourceName, (sourceRaw.get(r.sourceName) ?? 0) + sign * PER_ITEM_SOURCE_WEIGHT);

    if (r.kind === "NOT_INTERESTED") {
      hiddenKeys.add(r.contentKey);
      const [kind, id] = r.contentKey.split(":");
      if (kind === "article") hiddenIds.articleIds.add(id);
      else if (kind === "paper") hiddenIds.paperIds.add(id);
      else if (kind === "model") hiddenIds.modelIds.add(id);
      else if (kind === "project") hiddenIds.projectIds.add(id);
    }
  }

  const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
  const topicWeight = new Map([...topicRaw].map(([k, v]) => [k, clamp(v, MAX_TOPIC_ADJUST)] as const));
  const sourceWeight = new Map([...sourceRaw].map(([k, v]) => [k, clamp(v, MAX_SOURCE_ADJUST)] as const));

  return { hiddenKeys, hiddenIds, byKey, topicWeight, sourceWeight };
}

export async function setFeedback(
  userId: string,
  ref: BookmarkItemRef,
  kind: FeedbackKind,
  reason: FeedbackReason | undefined,
  snapshot: { title: string; topicNames: string[]; sourceName?: string | null }
) {
  const contentKey = computeContentKey(ref);
  return db.contentFeedback.upsert({
    where: { userId_contentKey: { userId, contentKey } },
    update: { kind, reason, title: snapshot.title, topicNames: snapshot.topicNames, sourceName: snapshot.sourceName ?? null },
    create: {
      userId,
      contentKey,
      kind,
      reason,
      title: snapshot.title,
      topicNames: snapshot.topicNames,
      sourceName: snapshot.sourceName ?? null
    }
  });
}

export async function clearFeedback(userId: string, ref: BookmarkItemRef) {
  const contentKey = computeContentKey(ref);
  await db.contentFeedback.deleteMany({ where: { userId, contentKey } });
}
