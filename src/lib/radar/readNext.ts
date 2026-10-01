import { db } from "@/lib/db";
import { rankScore } from "./rank";
import { SOURCE_QUALITY } from "@/lib/ingestion/classify";
import { getBehavioralTopicBoost, mergeInterestSignals } from "./behavior";
import { getPersonalizationSignals, applyFeedbackToInterests, excludeClause } from "@/lib/personalize/feedback";
import { getUserFocus } from "@/lib/personalize/focus";
import { parseRequest, focusMultiplier } from "@/lib/personalize/query";

const RECOMMENDATION_WINDOW_DAYS = 45;

/** Top papers worth reading right now — NOT the same as "recently published"
 *  (see Research page, which is a plain recency sort). A paper published
 *  three weeks ago can still be the best recommendation if it's highly
 *  relevant to the user's interests and hasn't been read yet. */
export async function getReadNext(userId: string, limit = 5) {
  const since = new Date();
  since.setDate(since.getDate() - RECOMMENDATION_WINDOW_DAYS);

  const [interests, behavioralBoost, signals, focus, readPaperIds, bookmarkedPaperIds] = await Promise.all([
    db.userInterest.findMany({ where: { userId } }),
    getBehavioralTopicBoost(userId),
    getPersonalizationSignals(userId),
    getUserFocus(userId),
    readIds(userId),
    bookmarkedIds(userId)
  ]);

  const papers = await db.researchPaper.findMany({
    where: {
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
      id: { notIn: excludeClause(signals.hiddenIds.paperIds) }
    },
    // Deterministic ordering before the take cap — same principle as
    // candidates.ts: without this, an important paper could be arbitrarily
    // excluded from the pool before ranking ever sees it, once the window
    // has more than 200 matching papers.
    orderBy: [{ importance: "desc" }, { relevance: "desc" }, { publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    include: { topics: true, source: true },
    take: 200
  });

  const explicitInterests = new Map<string, number>(interests.map((i: any): [string, number] => [i.topic, i.weight]));
  const interestMap = applyFeedbackToInterests(mergeInterestSignals(explicitInterests, behavioralBoost), signals.topicWeight);
  const focusReq = focus.request.trim() ? parseRequest(focus.request) : null;

  const withSignals: any[] = papers.map((p: any) => ({
    ...p,
    topicNames: p.topics.map((t: any) => t.name),
    sourceQuality: SOURCE_QUALITY[p.source?.name] ?? 0.5,
    sourceName: p.source?.name,
    previouslySeen: readPaperIds.has(p.id),
    bookmarked: bookmarkedPaperIds.has(p.id)
  }));

  return withSignals
    .map((p) => {
      const m = focusMultiplier({ title: p.title, summary: p.aiSummary ?? p.abstract, topics: p.topicNames }, focusReq);
      if (m === null) return null; // "-word" in the focus field hard-excludes here too
      const sourceAdj = p.sourceName ? signals.sourceWeight.get(p.sourceName) ?? 0 : 0;
      return { p, score: (rankScore(p, interestMap) + sourceAdj * 0.5) * m };
    })
    .filter((x): x is { p: any; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

async function readIds(userId: string) {
  const rows = await db.userReadHistory.findMany({ where: { userId, paperId: { not: null } }, select: { paperId: true } });
  return new Set(rows.map((r: any) => r.paperId).filter(Boolean));
}

async function bookmarkedIds(userId: string) {
  const rows = await db.bookmark.findMany({ where: { userId, paperId: { not: null } }, select: { paperId: true } });
  return new Set(rows.map((r: any) => r.paperId).filter(Boolean));
}
