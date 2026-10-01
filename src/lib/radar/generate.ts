import { db } from "@/lib/db";
import { completeJSON } from "@/lib/ai/client";
import { isAIQuotaError } from "@/lib/ai/errors";
import { radarBriefPrompt } from "@/lib/ai/prompts";
import { getCheckpoint, markCheckpoint, acquireRadarLock, releaseRadarLock, recordRadarRequest } from "./checkpoint";
import { getCandidatesInWindow, candidateToItemRef, type RadarCandidate } from "./candidates";
import { rankScore } from "./rank";
import { getReadNext } from "./readNext";
import { getBehavioralTopicBoost, mergeInterestSignals } from "./behavior";
import { validateRadarResponse } from "./validateResponse";
import { getOverallFreshness } from "@/lib/sources/health";
import { getPersonalizationSignals, applyFeedbackToInterests } from "@/lib/personalize/feedback";
import { getUserFocus } from "@/lib/personalize/focus";
import { parseRequest, focusMultiplier } from "@/lib/personalize/query";

const MAX_DEVELOPMENTS = 5;
const MAX_RECOMMENDATIONS = 3;
const NOTHING_NEW_MESSAGE = "Nothing major changed since your last check.";

const LOCK_RETRY_ATTEMPTS = 4;
const LOCK_RETRY_DELAY_MS = 750;

/**
 * Core "since last check" flow. Only a *successful* call here advances the
 * checkpoint — opening the app, or a failed generation, must never advance
 * it.
 *
 * Concurrency: guarded by an atomic DB-row lock (acquireRadarLock). This
 * function NEVER proceeds into generation without actually holding the
 * lock — if it can't acquire it after a few short retries, it returns the
 * most recent existing brief (or throws, if there truly is nothing to
 * return) rather than racing the request that does hold it.
 */
/** Thrown when the Radar lock couldn't be acquired and no fresh brief
 *  appeared while waiting — signals the caller to tell the user generation
 *  is still in progress, rather than silently returning an unrelated old
 *  brief and implying it's the result of this request. */
export class RadarInProgressError extends Error {
  constructor() {
    super("Radar generation is already in progress for this user.");
    this.name = "RadarInProgressError";
  }
}

/** Thrown when the LLM's Radar response was unusable (malformed shape, or
 *  every claimed development referenced an invalid candidateId) — this must
 *  propagate as a genuine generation failure, NOT be reinterpreted as a
 *  quiet period. Persisting "Nothing major changed" and advancing the
 *  checkpoint here would mean the user permanently loses the opportunity to
 *  see whatever real developments existed. See validateResponse.ts's policy
 *  comment for the exact failure criteria. */
export class RadarGenerationError extends Error {
  constructor(reason: string) {
    super(`Radar generation failed: ${reason}`);
    this.name = "RadarGenerationError";
  }
}

export async function generateRadarBriefing(userId: string) {
  const requestStartedAt = new Date();
  await recordRadarRequest(userId, requestStartedAt);
  let lockToken = await acquireRadarLock(userId);

  for (let attempt = 0; !lockToken && attempt < LOCK_RETRY_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
    lockToken = await acquireRadarLock(userId);
  }

  if (!lockToken) {
    // Another request is genuinely still generating. Only return a brief
    // that was actually CREATED during our wait (i.e. is plausibly the
    // result of the concurrent request we were waiting behind) — never an
    // arbitrary older brief, which would misrepresent an unrelated past
    // result as the answer to this request.
    const freshBrief = await db.radarBrief.findFirst({
      where: { userId, createdAt: { gte: requestStartedAt } },
      orderBy: { createdAt: "desc" },
      include: { items: { include: { article: true, paper: true, model: true, project: true } } }
    });
    if (freshBrief) return freshBrief;
    throw new RadarInProgressError();
  }

  try {
    return await doGenerate(userId);
  } finally {
    // Token-gated: only clears the lock if it's still OUR token. If our
    // generation ran long enough to be stale-takeover'd by another request,
    // this is a no-op instead of clearing the new owner's lock out from
    // under it — see the doc comment on releaseRadarLock.
    await releaseRadarLock(userId, lockToken);
  }
}

async function doGenerate(userId: string) {
  const { from, isFirstRun } = await getCheckpoint(userId);
  const to = new Date();

  const [interests, behavioralBoost, signals, focus, candidates, recommendedPapers] = await Promise.all([
    db.userInterest.findMany({ where: { userId } }),
    getBehavioralTopicBoost(userId),
    getPersonalizationSignals(userId),
    getUserFocus(userId),
    getCandidatesInWindow(userId, from, to),
    getReadNext(userId, MAX_RECOMMENDATIONS * 2)
  ]);

  const explicitInterests = new Map<string, number>(interests.map((i: any): [string, number] => [i.topic, i.weight]));
  const interestMap = applyFeedbackToInterests(mergeInterestSignals(explicitInterests, behavioralBoost), signals.topicWeight);
  const focusReq = focus.request.trim() ? parseRequest(focus.request) : null;

  // "Not interested" is a hard hide everywhere, not just a ranking nudge —
  // and a "-word" in the focus field hard-excludes too, same as it does on
  // the list pages (see rankList.ts).
  const rankedCandidates = candidates
    .filter((c) => !signals.hiddenKeys.has(c.candidateId))
    .map((c) => {
      const m = focusMultiplier({ title: c.title, summary: c.aiSummary, topics: c.topicNames }, focusReq);
      return m === null ? null : { c, score: rankScore(c, interestMap) * m };
    })
    .filter((x): x is { c: RadarCandidate; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DEVELOPMENTS * 2)
    .map((x) => x.c);

  const rankedPapers = recommendedPapers.filter((p: any) => !signals.hiddenKeys.has(`paper:${p.id}`));

  if (rankedCandidates.length === 0 && rankedPapers.length === 0) {
    const message = isFirstRun ? FIRST_RUN_EMPTY_MESSAGE : await quietPeriodMessage();
    return persistOrReuse(userId, from, to, message, []);
  }

  let raw: unknown;
  try {
    raw = await completeJSON<unknown>(
    radarBriefPrompt({
      userInterests: interests.map((i: any) => i.topic),
      developments: rankedCandidates.map((c) => ({
        candidateId: c.candidateId,
        title: c.title,
        summary: c.aiSummary ?? "",
        keyPoint: c.keyPoint ?? ""
      })),
      candidatePapers: rankedPapers.map((p: any) => ({
        candidateId: `paper:${p.id}`,
        title: p.title,
        summary: p.aiSummary ?? p.abstract ?? "",
        keyPoint: p.keyContribution ?? ""
      }))
    })
    );
  } catch (err) {
    if (!isAIQuotaError(err)) throw err;
    // Free-tier quota is gone: build the briefing from the ranking we already
    // computed (importance/recency/your interests) instead of failing.
    console.warn("[radar] AI quota reached — using a ranked, non-AI briefing.");
    raw = {
      summary: "AI summaries are paused (daily free-tier quota reached), so this update is ranked by importance and your interests only.",
      developments: rankedCandidates.slice(0, MAX_DEVELOPMENTS).map((c) => ({
        candidateId: c.candidateId,
        whyItMatters: (c.keyPoint || c.aiSummary || "").slice(0, 300)
      })),
      recommendations: rankedPapers.slice(0, MAX_RECOMMENDATIONS).map((p: any) => ({
        candidateId: `paper:${p.id}`,
        whyRead: (p.keyContribution || p.aiSummary || p.abstract || "").slice(0, 300)
      }))
    };
  }

  // paperAsCandidate preserves the metadata readNext.ts already computed
  // (topics, source quality, previouslySeen/bookmarked) instead of
  // rebuilding it with placeholder values — those signals were being
  // silently discarded here before.
  const allCandidates: RadarCandidate[] = [...rankedCandidates, ...rankedPapers.map((p: any) => paperAsCandidate(p))];

  // completeJSON only proves the response was valid JSON — it says nothing
  // about whether it has the shape we asked for. validateRadarResponse is
  // the actual schema+semantic gate. An unusable response (`ok: false`)
  // MUST fail generation here — before persistOrReuse is ever called — so
  // no brief is persisted and the checkpoint doesn't advance. Reinterpreting
  // a malformed/unusable LLM response as "nothing changed" would silently
  // cost the user real developments they never got to see.
  const ai = validateRadarResponse(raw, allCandidates);
  if (!ai.ok) {
    throw new RadarGenerationError(ai.reason);
  }

  const developmentItems = ai.developments
    .slice(0, MAX_DEVELOPMENTS)
    .map((d, i) => ({ ref: candidateToItemRef(d.candidateId, allCandidates), reason: d.reason, rank: i }))
    .filter((d): d is typeof d & { ref: NonNullable<ReturnType<typeof candidateToItemRef>> } => d.ref !== null);

  const recommendationItems = ai.recommendations
    .slice(0, MAX_RECOMMENDATIONS)
    .map((r, i) => ({ ref: candidateToItemRef(r.candidateId, allCandidates), reason: r.reason, rank: i }))
    .filter((r): r is typeof r & { ref: NonNullable<ReturnType<typeof candidateToItemRef>> } => r.ref !== null);

  const summary = developmentItems.length === 0 ? await quietPeriodMessage() : ai.summary || (await quietPeriodMessage());

  return persistOrReuse(userId, from, to, summary, [
    ...developmentItems.map((d) => ({ kind: "development", rank: d.rank, reason: d.reason, ...d.ref })),
    ...recommendationItems.map((r) => ({ kind: "recommendation", rank: r.rank, reason: r.reason, ...r.ref }))
  ]);
}

/**
 * Persists the brief, its items, AND the checkpoint advance as ONE atomic
 * transaction — previously these were separate calls, so a failure between
 * "brief created" and "checkpoint advanced" could leave the two
 * inconsistent (a brief existing but the checkpoint not reflecting it, or
 * vice versa). Either both happen or neither does.
 */
async function persistOrReuse(userId: string, from: Date, to: Date, summary: string, items: any[]) {
  try {
    const brief = await db.$transaction(async (tx: any) => {
      const created = await tx.radarBrief.create({
        data: { userId, checkpointFrom: from, checkpointTo: to, summary, items: { create: items } },
        include: { items: { include: { article: true, paper: true, model: true, project: true } } }
      });
      await markCheckpoint(userId, to, tx as any);
      return created;
    });
    return brief;
  } catch (err: any) {
    // Unique constraint on (userId, checkpointFrom, checkpointTo) — a
    // concurrent request already created this exact brief; reuse it instead
    // of erroring or duplicating. Duck-typed (err.code) rather than
    // instanceof Prisma.PrismaClientKnownRequestError, which needs a
    // generated client to resolve correctly.
    if (err?.code === "P2002") {
      const existing = await db.radarBrief.findUnique({
        where: { userId_checkpointFrom_checkpointTo: { userId, checkpointFrom: from, checkpointTo: to } },
        include: { items: { include: { article: true, paper: true, model: true, project: true } } }
      });
      if (existing) return existing;
    }
    throw err;
  }
}

function paperAsCandidate(p: any): RadarCandidate {
  return {
    candidateId: `paper:${p.id}`,
    kind: "paper",
    dbId: p.id,
    title: p.title,
    url: p.url,
    publishedAt: p.publishedAt,
    discoveredAt: p.createdAt,
    // readNext.ts already computed these real signals — reuse them instead
    // of blanking them back to placeholders.
    topicNames: p.topicNames ?? [],
    importance: p.importance,
    relevance: p.relevance,
    novelty: p.novelty,
    sourceQuality: p.sourceQuality ?? 0.5,
    previouslySeen: !!p.previouslySeen,
    bookmarked: !!p.bookmarked,
    aiSummary: p.aiSummary ?? p.abstract ?? undefined,
    keyPoint: p.keyContribution ?? undefined
  };
}

const FIRST_RUN_EMPTY_MESSAGE =
  "This is your first AION Radar. Not enough has been ingested yet to show meaningful developments — check back after a few ingestion runs.";

/** Distinguishes "genuinely nothing new" from "AION's sources haven't
 *  updated recently, so this might be incomplete" — these must never look
 *  identical to the person reading them. */
async function quietPeriodMessage(): Promise<string> {
  const freshness = await getOverallFreshness();
  if (freshness === "stale") {
    return "Some AI sources haven't updated recently — your Radar may be incomplete rather than genuinely quiet.";
  }
  if (freshness === "insufficient_data") {
    return "AION hasn't collected enough information yet to say whether anything changed.";
  }
  return NOTHING_NEW_MESSAGE;
}
