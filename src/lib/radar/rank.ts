export type Rankable = {
  importance: number;
  novelty?: number;
  relevance: number;
  /** Null when the real publication date is unknown — recency then falls
   *  back to discoveredAt so an undated item isn't penalized as if it were
   *  ancient, but also isn't misrepresented as freshly published. */
  publishedAt: Date | null;
  discoveredAt?: Date;
  topicNames: string[];
  sourceQuality?: number;
  previouslySeen?: boolean;
  bookmarked?: boolean;
};

// Explicit, separately-visible weights per factor (see README's ranking
// notes) — deliberately a simple weighted sum, not a learned model.
const WEIGHTS = {
  importance: 0.28,
  novelty: 0.12,
  relevance: 0.12,
  recency: 0.13,
  interestMatch: 0.2,
  sourceQuality: 0.15
};

/** A simple, explainable weighted score — intentionally not an ML model.
 *  Good enough for v1; swap in something fancier later if it's warranted. */
export function rankScore(item: Rankable, userInterests: Map<string, number>): number {
  const effectiveDate = item.publishedAt ?? item.discoveredAt ?? new Date(0);
  const ageDays = (Date.now() - effectiveDate.getTime()) / 86_400_000;
  const recency = Math.max(0, 1 - ageDays / 14); // decays to 0 over ~2 weeks

  const interestMatch =
    item.topicNames.length === 0
      ? 0.3
      : Math.min(1, item.topicNames.reduce((sum, t) => sum + (userInterests.get(t) ?? 0), 0));

  let score =
    WEIGHTS.importance * item.importance +
    WEIGHTS.novelty * (item.novelty ?? 0.5) +
    WEIGHTS.relevance * item.relevance +
    WEIGHTS.recency * recency +
    WEIGHTS.interestMatch * interestMatch +
    WEIGHTS.sourceQuality * (item.sourceQuality ?? 0.5);

  // Previous exposure is a ranking signal, not a hard filter (see
  // lib/radar/generate.ts): a genuinely major item can still resurface, a
  // minor one you've already seen should sink well below new material.
  if (item.previouslySeen) {
    score *= item.importance > 0.8 ? 0.85 : 0.5;
  }
  // A bookmark is an explicit "I care about this" signal — small boost so an
  // update to something you've saved doesn't get lost under brand-new items.
  if (item.bookmarked) {
    score *= 1.15;
  }

  return score;
}

export function sortByRank<T extends Rankable>(items: T[], userInterests: Map<string, number>): T[] {
  return [...items].sort((a, b) => rankScore(b, userInterests) - rankScore(a, userInterests));
}
