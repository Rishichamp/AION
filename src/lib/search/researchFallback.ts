export type ResearchResult = { title: string; url: string; snippet: string; publishedAt: Date | null; arxivId?: string };

/** Keyword search against arXiv's public API (no key required) — distinct
 *  from lib/sources/arxiv.ts's category-based ingestion connector, this is a
 *  targeted, on-demand keyword query used only as a research-specific search
 *  fallback (see /api/command's topic_research case). Tried BEFORE the
 *  generic web-search fallback: "show me SSM research" should surface arXiv
 *  papers, not a random blog post that happens to mention the term. */
export async function targetedArxivSearch(topicName: string, limit = 5): Promise<ResearchResult[]> {
  try {
    const url =
      `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:"${topicName}"`)}` +
      `&sortBy=relevance&sortOrder=descending&max_results=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`arXiv responded ${res.status}`);
    const xml = await res.text();

    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
    return entries.map((entry) => {
      const title = pick(entry, "title")?.replace(/\s+/g, " ").trim() ?? "Untitled";
      const idUrl = pick(entry, "id") ?? "";
      const arxivId = idUrl.split("/abs/")[1]?.trim();
      const published = pick(entry, "published");
      const summary = pick(entry, "summary")?.replace(/\s+/g, " ").trim() ?? "";
      return { title, url: idUrl, snippet: summary.slice(0, 300), publishedAt: published ? new Date(published) : null, arxivId };
    });
  } catch (err) {
    console.error("[targetedArxivSearch] failed:", err);
    return [];
  }
}

function pick(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}.*?>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1];
}

/** Persists arXiv fallback hits as ResearchPaper rows (not generic
 *  Articles) so they show up correctly typed everywhere — Research page,
 *  Read Next, future Radar candidates — not just as a one-off search result. */
export async function cacheResearchResults(results: ResearchResult[]) {
  if (results.length === 0) return;
  const { db } = await import("@/lib/db");
  const { canonicalUrl } = await import("@/lib/ingestion/dedupe");

  const source = await db.source.upsert({
    where: { name: "arXiv" },
    update: {},
    create: { name: "arXiv", kind: "ARXIV", endpoint: "targeted-fallback", category: "research" }
  });

  for (const r of results) {
    if (!r.arxivId || !r.publishedAt) continue; // never fabricate a publish date — see pipeline.ts's validate() for the same rule
    const existing = await db.researchPaper.findUnique({ where: { arxivId: r.arxivId } });
    if (existing) continue;
    await db.researchPaper
      .create({
        data: {
          sourceId: source.id,
          title: r.title,
          url: r.url,
          arxivId: r.arxivId,
          abstract: r.snippet,
          authors: [],
          categories: [],
          publishedAt: r.publishedAt,
          importance: 0.5,
          relevance: 0.6,
          novelty: 0.5,
          origin: "SEARCH_FALLBACK"
        }
      })
      .catch(() => {});
  }
}
