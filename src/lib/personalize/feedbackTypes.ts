// Pure types + logic for "not interested" / "more like this" feedback — no
// DB import, so anything that only needs to *apply* an already-computed
// PersonalizationSignals (rankList.ts, and its tests) doesn't have to pull
// in a live database client. See feedback.ts for the DB-touching half
// (fetching/aggregating rows, writing feedback) that produces this shape.
export type FeedbackKind = "NOT_INTERESTED" | "MORE_LIKE_THIS";
export type FeedbackReason = "off_topic" | "seen_it" | "too_basic" | "wrong_source" | "other";

export type IdSets = { articleIds: Set<string>; paperIds: Set<string>; modelIds: Set<string>; projectIds: Set<string> };
export const emptyIdSets = (): IdSets => ({ articleIds: new Set(), paperIds: new Set(), modelIds: new Set(), projectIds: new Set() });

export type PersonalizationSignals = {
  /** contentKey ("paper:<id>" etc.) marked NOT_INTERESTED — hard-hide everywhere. */
  hiddenKeys: Set<string>;
  hiddenIds: IdSets;
  /** Every feedback row, for rehydrating ContentCard's initial thumb state. */
  byKey: Map<string, FeedbackKind>;
  /** Additive per-topic adjustment, positive or negative, clamped to
   *  [-MAX_TOPIC_ADJUST, +MAX_TOPIC_ADJUST]. Merge into rank.ts's interest map. */
  topicWeight: Map<string, number>;
  /** Same idea, keyed by Source.name. */
  sourceWeight: Map<string, number>;
};

export const emptySignals = (): PersonalizationSignals => ({
  hiddenKeys: new Set(),
  hiddenIds: emptyIdSets(),
  byKey: new Map(),
  topicWeight: new Map(),
  sourceWeight: new Map()
});

/** Merges feedback's topic adjustment into an existing interest map. Unlike
 *  radar/behavior.ts's mergeInterestSignals (additive-boost-only, floor 0),
 *  this allows negative values through on purpose — a muted topic should be
 *  able to pull a score below where it'd sit with no signal at all. */
export function applyFeedbackToInterests(interests: Map<string, number>, topicWeight: Map<string, number>): Map<string, number> {
  const merged = new Map(interests);
  for (const [topic, adj] of topicWeight) merged.set(topic, (merged.get(topic) ?? 0) + adj);
  return merged;
}

/** Prisma `id: { notIn: [...] }` needs a non-empty array to mean "no
 *  exclusion" — an empty array is instead treated as "match nothing" by
 *  some call sites elsewhere in this codebase, so mirror that same
 *  sentinel-id convention (see radar/candidates.ts's idsForKind). */
export function excludeClause(ids: Set<string>): string[] {
  return ids.size > 0 ? [...ids] : ["__none__"];
}
