import { db } from "@/lib/db";
import { matchTopic } from "@/lib/topics/config";

const MAX_BEHAVIORAL_BOOST = 0.4; // capped well below an explicit interest (weight 1.0) — behavior supplements, doesn't override
const HALF_LIFE_DAYS = 30; // a signal from 30 days ago counts half as much as one from today
const MIN_QUERY_LENGTH = 3; // ignore empty/near-empty queries entirely — not enough signal to mean anything
const HISTORY_LOOKBACK_ROWS = 500; // bound query cost for long-lived accounts

/** Exponential recency decay — a topic someone was obsessed with six months
 *  ago shouldn't permanently dominate their personalization over something
 *  they've been reading about this week. Half-life of HALF_LIFE_DAYS. */
export function decayWeight(at: Date, now: Date, halfLifeDays = HALF_LIFE_DAYS): number {
  const ageDays = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** A query is "noise" if it's too short/sparse to plausibly express real
 *  intent — an empty string, a stray character, whitespace. Anything that
 *  doesn't resolve to a known topic alias already contributes nothing (see
 *  the matchTopic() check below), so this is specifically about not even
 *  bothering to try on obvious junk. */
export function isNoiseQuery(query: string): boolean {
  return query.trim().length < MIN_QUERY_LENGTH;
}

/**
 * Counts how often each topic shows up across what the user has actually
 * opened (UserReadHistory), bookmarked, and searched/asked about
 * (SearchLog), weighted by recency (older activity decays) rather than a
 * flat count, and turns that into a small additive boost per topic. Read
 * Next shouldn't only reflect the checkboxes someone set once in Settings;
 * it should also notice what they keep coming back to or keep asking AION
 * about — recently.
 */
export async function getBehavioralTopicBoost(userId: string, now: Date = new Date()): Promise<Map<string, number>> {
  const [readArticles, readPapers, bookmarks, searches] = await Promise.all([
    db.userReadHistory.findMany({
      where: { userId, articleId: { not: null } },
      include: { article: { include: { topics: true } } },
      orderBy: { readAt: "desc" },
      take: HISTORY_LOOKBACK_ROWS
    }),
    db.userReadHistory.findMany({
      where: { userId, paperId: { not: null } },
      include: { paper: { include: { topics: true } } },
      orderBy: { readAt: "desc" },
      take: HISTORY_LOOKBACK_ROWS
    }),
    db.bookmark.findMany({
      where: { userId },
      include: { article: { include: { topics: true } }, paper: { include: { topics: true } } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LOOKBACK_ROWS
    }),
    db.searchLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200, select: { query: true, createdAt: true } })
  ]);

  const counts = new Map<string, number>();
  const bump = (topics: { name: string }[] | undefined, weight: number) => {
    for (const t of topics ?? []) counts.set(t.name, (counts.get(t.name) ?? 0) + weight);
  };

  for (const r of readArticles as any[]) bump(r.article?.topics, 1 * decayWeight(r.readAt, now));
  for (const r of readPapers as any[]) bump(r.paper?.topics, 1 * decayWeight(r.readAt, now));
  for (const b of bookmarks as any[]) {
    const w = 1.5 * decayWeight(b.createdAt, now); // a bookmark is a stronger signal than just opening something once
    bump(b.article?.topics, w);
    bump(b.paper?.topics, w);
  }
  for (const s of searches as any[]) {
    if (isNoiseQuery(s.query)) continue;
    const topic = matchTopic(s.query); // alias-aware, same resolution as command parsing
    if (topic) bump([{ name: topic.name }], 0.75 * decayWeight(s.createdAt, now)); // repeated asking is real, weighted a bit below an open/bookmark
  }

  if (counts.size === 0) return new Map();

  const max = Math.max(...counts.values());
  const boost = new Map<string, number>();
  for (const [topic, count] of counts) {
    boost.set(topic, (count / max) * MAX_BEHAVIORAL_BOOST);
  }
  return boost;
}

/** Merges explicit interests with the smaller behavioral boost — additive,
 *  capped at 1.0 so behavior alone can never outweigh an explicit interest. */
export function mergeInterestSignals(explicit: Map<string, number>, behavioral: Map<string, number>): Map<string, number> {
  const merged = new Map(explicit);
  for (const [topic, boost] of behavioral) {
    merged.set(topic, Math.min(1, (merged.get(topic) ?? 0) + boost));
  }
  return merged;
}
