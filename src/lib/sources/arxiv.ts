import type { SourceConnector } from "./types";

// arXiv's public API (no key required): https://info.arxiv.org/help/api/user-manual.html
const CATEGORIES = ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.RO", "stat.ML"];

export const arxivConnector: SourceConnector = {
  name: "arXiv",
  category: "research",
  async fetch(sinceIso) {
    try {
      // arXiv's query DSL uses literal, unencoded "+" characters as its AND/OR
      // separators — encoding the whole query (encodeURIComponent on "+OR+")
      // turns them into "%2B", which arXiv reads as a literal plus sign
      // instead of the operator, silently matching zero results. Each term is
      // encoded on its own; the "+OR+" joiners are left untouched.
      const search = CATEGORIES.map((c) => encodeURIComponent(`cat:${c}`)).join("+OR+");
      const url =
        `http://export.arxiv.org/api/query?search_query=${search}` +
        `&sortBy=submittedDate&sortOrder=descending&max_results=50`;

      const res = await fetch(url, { next: { revalidate: 0 } });
      if (!res.ok) throw new Error(`arXiv responded ${res.status}`);
      const xml = await res.text();

      const since = sinceIso ? new Date(sinceIso) : null;
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);

      return entries
        .map((entry) => {
          const title = pick(entry, "title")?.replace(/\s+/g, " ").trim() ?? "Untitled";
          const idUrl = pick(entry, "id") ?? "";
          const arxivId = idUrl.split("/abs/")[1]?.trim();
          const published = pick(entry, "published");
          const summary = pick(entry, "summary")?.replace(/\s+/g, " ").trim();
          const authors = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map((a) => a[1]);
          const categories = [...entry.matchAll(/<category term="(.*?)"/g)].map((c) => c[1]);
          const pdfUrl = idUrl ? idUrl.replace("/abs/", "/pdf/") : undefined;

          return {
            kind: "paper" as const,
            title,
            url: idUrl,
            publishedAt: published ? new Date(published) : null, // never fabricate — arXiv always provides this, but never guess if it somehow didn't
            authors,
            arxivId,
            pdfUrl,
            categories,
            description: summary
          };
        })
        .filter((it) => it.publishedAt !== null && (!since || it.publishedAt > since));
    } catch (err) {
      console.error("[arxivConnector] failed:", err);
      return [];
    }
  }
};

function pick(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}.*?>([\\s\\S]*?)<\\/${tag}>`));
  return m?.[1];
}
