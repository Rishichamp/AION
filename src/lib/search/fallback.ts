import { createHash } from "crypto";

export type WebResult = { title: string; url: string; snippet: string; publishedAt?: Date };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — narrow queries don't need fresher-than-that re-checks

/** Deletes expired SearchCache rows. Called opportunistically from
 *  targetedWebSearch (cheap, indexed on expiresAt) so stale cache entries
 *  don't accumulate indefinitely; also exported for use from a scheduled
 *  job if a deployment prefers that instead. */
export async function cleanupExpiredSearchCache(): Promise<number> {
  const { db } = await import("@/lib/db");
  const result = await db.searchCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}

/** Narrow, query-specific web search — NOT a general crawler. Called only
 *  when a specific command's DB query came back thin (see callers in
 *  src/app/api/command/route.ts). Checks a query-level cache first (see
 *  SearchCache in schema.prisma) so an identical query within the TTL never
 *  re-hits the provider — this is a distinct cache from cacheWebResults()
 *  below, which caches the resulting *content*, not the *query*. Returns []
 *  rather than throwing when no provider is configured. */
export async function targetedWebSearch(query: string, limit = 5): Promise<WebResult[]> {
  const PROVIDER = process.env.SEARCH_PROVIDER ?? "none";
  const API_KEY = process.env.SEARCH_API_KEY ?? "";
  if (PROVIDER === "none" || !API_KEY) return [];

  const normalized = query.trim().toLowerCase();
  const hash = createHash("sha256").update(`${PROVIDER}:${normalized}`).digest("hex");

  const { db } = await import("@/lib/db");
  cleanupExpiredSearchCache().catch((err) => console.error("[search fallback] cache cleanup failed:", err)); // fire-and-forget, never blocks the actual search
  const cached = await db.searchCache.findUnique({ where: { queryHash: hash } });
  if (cached && cached.expiresAt > new Date()) {
    return cached.results as unknown as WebResult[];
  }

  try {
    let results: WebResult[] = [];
    switch (PROVIDER) {
      case "brave":
        results = await searchBrave(query, limit, API_KEY);
        break;
      default:
        console.error(`[search fallback] unknown SEARCH_PROVIDER "${PROVIDER}"`);
        return [];
    }

    await db.searchCache
      .upsert({
        where: { queryHash: hash },
        update: { results: results as any, createdAt: new Date(), expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
        create: {
          queryHash: hash,
          normalizedQuery: normalized,
          provider: PROVIDER,
          results: results as any,
          expiresAt: new Date(Date.now() + CACHE_TTL_MS)
        }
      })
      .catch((err: any) => console.error("[search fallback] cache write failed:", err));

    return results;
  } catch (err) {
    console.error("[search fallback] request failed:", err);
    return [];
  }
}

async function searchBrave(query: string, limit: number, apiKey: string): Promise<WebResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, { headers: { "X-Subscription-Token": apiKey, accept: "application/json" } });
  if (!res.ok) throw new Error(`Brave Search API responded ${res.status}`);
  const data = await res.json();

  return (data.web?.results ?? []).slice(0, limit).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.description
    // Deliberately no publishedAt: Brave's "age" field is relative text
    // ("3 days ago"), not a reliably parseable date — see cacheWebResults,
    // which stores these as publishedAt: null rather than guessing "now".
  }));
}

/** Persists fallback results as Article rows (source "Web Search") so a
 *  future DB-first query finds them directly. Publication date is left null
 *  — a paper found today isn't necessarily *published* today; createdAt
 *  (discoveredAt) already records when AION found it. Deliberately skips the
 *  AI summarize/score pass to keep the fallback path cheap. */
export async function cacheWebResults(results: WebResult[]) {
  if (results.length === 0) return;
  const { db } = await import("@/lib/db");
  const { canonicalUrl } = await import("@/lib/ingestion/dedupe");

  const source = await db.source.upsert({
    where: { name: "Web Search" },
    update: {},
    create: { name: "Web Search", kind: "RSS_NEWS", endpoint: "targeted-fallback", category: "news", enabled: false }
  });

  for (const r of results) {
    const existing = await db.article.findFirst({ where: { canonicalUrl: canonicalUrl(r.url) } });
    if (existing) continue;
    await db.article
      .create({
        data: {
          sourceId: source.id,
          title: r.title,
          url: r.url,
          canonicalUrl: canonicalUrl(r.url),
          publishedAt: r.publishedAt ?? null, // unknown, not "now" — see model doc comment
          description: r.snippet,
          importance: 0.4,
          relevance: 0.4,
          origin: "SEARCH_FALLBACK"
        }
      })
      .catch(() => {}); // best-effort cache; a race on the unique url shouldn't fail the request
  }
}
