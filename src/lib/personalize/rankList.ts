// Shared re-ranking for the four list pages (Research/News/Models/Open
// Source): takes a pool ordered by the DB's importance/date, then re-sorts
// it using the same explainable weighted score Radar uses (rank.ts),
// additionally boosted by free-text relevance to the user's "what I'm
// looking for" focus and nudged by their not-interested/more-like-this
// feedback — and hard-excludes anything muted. This is what makes the
// focus field act like a standing search query instead of just decoration.
import { rankScore, type Rankable } from "@/lib/radar/rank";
import { applyFeedbackToInterests, type PersonalizationSignals } from "./feedbackTypes";
import { parseRequest, focusMultiplier, type SearchableFields } from "./query";
import type { UserFocusData } from "./focus";

export type Listable = Rankable & SearchableFields & { id: string; sourceName?: string };

export function rankAndFilterList<T extends Listable>(
  pool: T[],
  interests: Map<string, number>,
  signals: PersonalizationSignals,
  focus: UserFocusData,
  limit: number
): T[] {
  const req = focus.request.trim() ? parseRequest(focus.request) : null;
  const mutedReq = focus.mutedKeywords.length > 0 ? parseRequest(focus.mutedKeywords.map((k) => `-${k}`).join(" ")) : null;
  const mergedInterests = applyFeedbackToInterests(interests, signals.topicWeight);
  const mutedSources = new Set(focus.mutedSources.map((s) => s.toLowerCase()));

  const scored = pool
    .filter((item) => item.sourceName == null || !mutedSources.has(item.sourceName.toLowerCase()))
    .map((item) => {
      const multiplier = focusMultiplier(item, req);
      if (multiplier === null) return null; // "-word" in the focus field is a hard exclude, like a search engine's "-term"
      if (mutedReq && focusMultiplier(item, mutedReq) === null) return null;

      const base = rankScore(item, mergedInterests);
      const sourceAdj = item.sourceName ? signals.sourceWeight.get(item.sourceName) ?? 0 : 0;
      return { item, score: (base + sourceAdj * 0.5) * multiplier };
    })
    .filter((x): x is { item: T; score: number } => x !== null);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}
