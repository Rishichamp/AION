import { db } from "@/lib/db";
import { SOURCE_QUALITY } from "@/lib/ingestion/classify";

export type CandidateKind = "article" | "paper" | "model" | "project";

export type RadarCandidate = {
  /** Opaque id sent to the LLM instead of a URL — see generate.ts for why
   *  never asking the LLM to reproduce a URL exactly matters. */
  candidateId: string;
  kind: CandidateKind;
  dbId: string;
  title: string;
  url: string;
  /** Null means "publication date unknown" — never defaulted to now(). */
  publishedAt: Date | null;
  discoveredAt: Date;
  topicNames: string[];
  importance: number;
  relevance: number;
  novelty: number;
  sourceQuality: number;
  previouslySeen: boolean;
  bookmarked: boolean;
  aiSummary?: string;
  keyPoint?: string;
};

const BACKLOG_LOOKBACK_DAYS = 14;

/** All Radar development candidates whose *effective* date (publishedAt, or
 *  discoveredAt when publishedAt is unknown) falls in (from, to] — PLUS a
 *  bounded backlog of items from the last BACKLOG_LOOKBACK_DAYS that were
 *  never shown in a past Radar brief and never read.
 *
 *  Why the backlog exists: if 10 important items arrive Monday but a
 *  Tuesday Radar run only has room to show 5 (see MAX_DEVELOPMENTS in
 *  generate.ts), the other 5 fall before the new checkpoint and would
 *  otherwise disappear forever, having never actually been surfaced to the
 *  user. This gives never-shown items a bounded second chance to compete
 *  for a slot on the next run, without resurrecting arbitrarily old content
 *  (capped at BACKLOG_LOOKBACK_DAYS, and ranking's prior-exposure penalty
 *  still applies once something HAS been shown or read — see rank.ts).
 *
 *  Covers all four content types AION monitors — previously Radar only
 *  ever looked at Articles, so a new paper, model release, or open-source
 *  project could never appear in "Since Your Last Check". */
export async function getCandidatesInWindow(userId: string, from: Date, to: Date): Promise<RadarCandidate[]> {
  // The MORE RECENT of "14 days ago" or the checkpoint — never the earlier
  // one. Using the earlier bound (a prior bug here) let the backlog window
  // extend arbitrarily far back whenever the checkpoint was stale (e.g. a
  // user who hasn't run Radar in 90 days), directly contradicting the
  // "bounded to BACKLOG_LOOKBACK_DAYS" guarantee. When the checkpoint is
  // already older than 14 days, this correctly collapses the backlog
  // window to empty — the normal (from, to] window already covers
  // everything in that case.
  const backlogSince = new Date(Math.max(from.getTime(), Date.now() - BACKLOG_LOOKBACK_DAYS * 86_400_000));

  const [seen, bookmarked, shown] = await Promise.all([seenIds(userId), bookmarkedIds(userId), shownIds(userId)]);

  // Backlog eligibility is "never shown AND never read" — previously only
  // shown-exclusion was applied, so an article the user opened manually
  // (never surfaced by a past Radar brief) could still get resurrected by
  // the backlog once the checkpoint moved past it. Union both sets.
  const excludedForBacklog = (kind: CandidateKind): string[] => {
    const merged = new Set([...idsForKind(shown, kind), ...idsForKind(seen, kind)].filter((id) => id !== "__none__"));
    return merged.size > 0 ? [...merged] : ["__none__"];
  };

  const [articles, papers, models, projects] = await Promise.all([
    db.article.findMany({
      where: {
        OR: [
          { publishedAt: { gt: from, lte: to } },
          { publishedAt: null, createdAt: { gt: from, lte: to } },
          // Backlog: dated articles by publishedAt, undated ones by their
          // effective date (createdAt/discoveredAt) — previously this
          // branch only matched publishedAt, so an undated article (e.g. a
          // web-search-fallback result, which never fabricates a date) was
          // silently ineligible for its second chance no matter how recent
          // its discoveredAt was.
          { publishedAt: { gte: backlogSince, lte: from }, id: { notIn: [...excludedForBacklog("article")] } },
          { publishedAt: null, createdAt: { gte: backlogSince, lte: from }, id: { notIn: [...excludedForBacklog("article")] } }
        ]
      },
      // Deterministic ordering BEFORE `take` — without this, Postgres can
      // return an arbitrary subset of matching rows once the pool exceeds
      // the cap, silently excluding a genuinely important candidate from
      // ever reaching the ranking stage at all. Final top-N is still
      // decided by sortByRank() in rank.ts; this only protects which rows
      // make it into that ranking pool in the first place.
      // NULLS LAST (explicit, not relying on Postgres defaults) + a unique
      // `id` tie-breaker — without the tie-breaker, rows with identical
      // importance/relevance/publishedAt have no defined order, so which
      // ones fall inside vs. outside the `take` cap is NOT actually
      // deterministic despite the other sort keys.
      orderBy: [{ importance: "desc" }, { relevance: "desc" }, { publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      include: { topics: true, source: true },
      take: 150
    }),
    db.researchPaper.findMany({
      where: {
        OR: [
          { publishedAt: { gt: from, lte: to } },
          { publishedAt: null, createdAt: { gt: from, lte: to } },
          { publishedAt: { gte: backlogSince, lte: from }, id: { notIn: [...excludedForBacklog("paper")] } },
          { publishedAt: null, createdAt: { gte: backlogSince, lte: from }, id: { notIn: [...excludedForBacklog("paper")] } }
        ]
      },
      orderBy: [{ importance: "desc" }, { relevance: "desc" }, { publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      include: { topics: true, source: true },
      take: 100
    }),
    db.modelRelease.findMany({
      where: {
        OR: [
          { releaseDate: { gt: from, lte: to } },
          { releaseDate: { gte: backlogSince, lte: from }, id: { notIn: [...excludedForBacklog("model")] } }
        ]
      },
      orderBy: [{ importance: "desc" }, { releaseDate: "desc" }, { id: "asc" }],
      take: 30
    }),
    db.openSourceProject.findMany({
      where: {
        // "new to AION" (createdAt), not "recently pushed to" — see pipeline.ts's upsert-on-repeat-sight
        OR: [
          { createdAt: { gt: from, lte: to } },
          { createdAt: { gte: backlogSince, lte: from }, id: { notIn: [...excludedForBacklog("project")] } }
        ]
      },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 30
    })
  ]);

  const out: RadarCandidate[] = [];

  for (const a of articles as any[]) {
    out.push({
      candidateId: `article:${a.id}`,
      kind: "article",
      dbId: a.id,
      title: a.title,
      url: a.url,
      publishedAt: a.publishedAt,
      discoveredAt: a.createdAt,
      topicNames: a.topics.map((t: any) => t.name),
      importance: a.importance,
      relevance: a.relevance,
      novelty: 0.5,
      sourceQuality: SOURCE_QUALITY[a.source?.name] ?? 0.5,
      previouslySeen: seen.articleIds.has(a.id),
      bookmarked: bookmarked.articleIds.has(a.id),
      aiSummary: a.aiSummary ?? a.description ?? undefined,
      keyPoint: a.keyPoint ?? undefined
    });
  }

  for (const p of papers as any[]) {
    out.push({
      candidateId: `paper:${p.id}`,
      kind: "paper",
      dbId: p.id,
      title: p.title,
      url: p.url,
      publishedAt: p.publishedAt,
      discoveredAt: p.createdAt,
      topicNames: p.topics.map((t: any) => t.name),
      importance: p.importance,
      relevance: p.relevance,
      novelty: p.novelty,
      sourceQuality: SOURCE_QUALITY[p.source?.name] ?? 0.5,
      previouslySeen: seen.paperIds.has(p.id),
      bookmarked: bookmarked.paperIds.has(p.id),
      aiSummary: p.aiSummary ?? p.abstract ?? undefined,
      keyPoint: p.keyContribution ?? undefined
    });
  }

  for (const m of models as any[]) {
    out.push({
      candidateId: `model:${m.id}`,
      kind: "model",
      dbId: m.id,
      title: `${m.name} (${m.organization})`,
      url: m.announcementUrl,
      publishedAt: m.releaseDate,
      discoveredAt: m.createdAt,
      topicNames: [],
      importance: m.importance ?? 0.6, // model releases are inherently notable
      relevance: 0.6,
      novelty: 0.7,
      sourceQuality: 0.8,
      previouslySeen: seen.modelIds.has(m.id),
      bookmarked: bookmarked.modelIds.has(m.id),
      aiSummary: m.description ?? undefined
    });
  }

  for (const proj of projects as any[]) {
    out.push({
      candidateId: `project:${proj.id}`,
      kind: "project",
      dbId: proj.id,
      title: proj.name,
      url: proj.repoUrl,
      publishedAt: proj.lastActivityAt,
      discoveredAt: proj.createdAt,
      topicNames: [],
      importance: proj.importance,
      relevance: 0.5,
      novelty: 0.5,
      sourceQuality: 0.6,
      previouslySeen: seen.projectIds.has(proj.id),
      bookmarked: bookmarked.projectIds.has(proj.id),
      aiSummary: proj.description ?? undefined,
      keyPoint: proj.whyItMatters ?? undefined
    });
  }

  return out;
}

/** Maps a validated candidateId back to the concrete FK field for a
 *  RadarItem row. Returns null for anything not in the supplied candidate
 *  set — callers must treat that as "discard this LLM output", never guess. */
export function candidateToItemRef(candidateId: string, candidates: RadarCandidate[]) {
  const match = candidates.find((c) => c.candidateId === candidateId);
  if (!match) return null;
  switch (match.kind) {
    case "article":
      return { articleId: match.dbId };
    case "paper":
      return { paperId: match.dbId };
    case "model":
      return { modelId: match.dbId };
    case "project":
      return { projectId: match.dbId };
  }
}

/** Read-only — counts what a Radar run *would* surface, without persisting
 *  anything or touching the checkpoint. Notifications use this instead of
 *  generateRadarBriefing(): sending a push must never silently advance the
 *  user's checkpoint, or they'd lose developments they never actually saw. */
import { sortByRank } from "./rank";
import { getBehavioralTopicBoost, mergeInterestSignals } from "./behavior";
import { getPersonalizationSignals, applyFeedbackToInterests } from "@/lib/personalize/feedback";

const MAX_DEVELOPMENTS = 5;

/**
 * Read-only — applies the SAME deterministic ranking and top-N cutoff
 * generateRadarBriefing uses to select its candidate pool, without
 * persisting anything, touching the checkpoint, or calling the LLM (a
 * notification doesn't need synthesized prose, just a reasonable count).
 *
 * IMPORTANT ACCURACY NOTE: this is the count of top-ranked CANDIDATES that
 * would compete for a development slot — not a guarantee of exactly how
 * many the actual Radar will show. The real generateRadarBriefing hands
 * these same candidates to the LLM, which may judge some as not
 * meaningful enough to report and select fewer. So `previewRadar` answers
 * "how many relevant developments are available", not "how many will
 * definitely appear" — callers (see /api/push/send) should word
 * notification text accordingly (e.g. "N relevant developments available"
 * rather than "N updates"), since the two numbers can legitimately differ.
 * Still a large accuracy improvement over a raw "everything unread" count,
 * which could say "17" when nothing past the top 5 would ever be relevant.
 */
export async function previewRadar(userId: string, from: Date, to: Date): Promise<{ count: number }> {
  const [interests, behavioralBoost, candidates, signals] = await Promise.all([
    db.userInterest.findMany({ where: { userId } }),
    getBehavioralTopicBoost(userId),
    getCandidatesInWindow(userId, from, to),
    getPersonalizationSignals(userId)
  ]);

  const explicitInterests = new Map<string, number>(interests.map((i: any): [string, number] => [i.topic, i.weight]));
  const interestMap = applyFeedbackToInterests(mergeInterestSignals(explicitInterests, behavioralBoost), signals.topicWeight);
  // A "not interested" item must not inflate a notification's count either.
  const visible = candidates.filter((c) => !signals.hiddenKeys.has(c.candidateId));
  const ranked = sortByRank(visible, interestMap).slice(0, MAX_DEVELOPMENTS);

  return { count: ranked.length };
}

async function shownIds(userId: string) {
  const rows = await db.radarItem.findMany({
    where: { brief: { userId } },
    select: { articleId: true, paperId: true, modelId: true, projectId: true }
  });
  return {
    articleIds: new Set(rows.map((r: any) => r.articleId).filter(Boolean)) as Set<string>,
    paperIds: new Set(rows.map((r: any) => r.paperId).filter(Boolean)) as Set<string>,
    modelIds: new Set(rows.map((r: any) => r.modelId).filter(Boolean)) as Set<string>,
    projectIds: new Set(rows.map((r: any) => r.projectId).filter(Boolean)) as Set<string>
  };
}

type ContentIdSets = Awaited<ReturnType<typeof shownIds>>;

/** Picks the right id set out of a {articleIds,paperIds,modelIds,projectIds}
 *  bundle (works for shownIds/seenIds/bookmarkedIds — all the same shape).
 *  Falls back to a sentinel that can never match a real cuid so `notIn: []`
 *  doesn't accidentally match Prisma's "no filter" behavior for an empty
 *  array. */
function idsForKind(sets: ContentIdSets, kind: CandidateKind): string[] {
  const map: Record<CandidateKind, Set<string>> = {
    article: sets.articleIds,
    paper: sets.paperIds,
    model: sets.modelIds,
    project: sets.projectIds
  };
  const set = map[kind];
  return set.size > 0 ? [...set] : ["__none__"];
}

async function seenIds(userId: string) {
  const rows = await db.userReadHistory.findMany({
    where: { userId },
    select: { articleId: true, paperId: true, modelId: true, projectId: true }
  });
  return {
    articleIds: new Set(rows.map((r: any) => r.articleId).filter(Boolean)) as Set<string>,
    paperIds: new Set(rows.map((r: any) => r.paperId).filter(Boolean)) as Set<string>,
    modelIds: new Set(rows.map((r: any) => r.modelId).filter(Boolean)) as Set<string>,
    projectIds: new Set(rows.map((r: any) => r.projectId).filter(Boolean)) as Set<string>
  };
}

async function bookmarkedIds(userId: string) {
  const rows = await db.bookmark.findMany({
    where: { userId },
    select: { articleId: true, paperId: true, modelId: true, projectId: true }
  });
  return {
    articleIds: new Set(rows.map((r: any) => r.articleId).filter(Boolean)),
    paperIds: new Set(rows.map((r: any) => r.paperId).filter(Boolean)),
    modelIds: new Set(rows.map((r: any) => r.modelId).filter(Boolean)),
    projectIds: new Set(rows.map((r: any) => r.projectId).filter(Boolean))
  };
}
