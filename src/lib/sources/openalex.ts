import type { SourceConnector } from "./types";

// OpenAlex is free and keyless: https://docs.openalex.org
export const openAlexConnector: SourceConnector = {
  name: "OpenAlex",
  category: "research",
  async fetch(sinceIso) {
    try {
      const since = sinceIso ? sinceIso.slice(0, 10) : daysAgo(3);
      const url =
        `https://api.openalex.org/works?filter=concepts.id:C154945302,from_publication_date:${since}` +
        `&sort=publication_date:desc&per_page=50&mailto=aion@example.com`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`OpenAlex responded ${res.status}`);
      const data = await res.json();

      return (data.results ?? []).map((w: any) => ({
        kind: "paper" as const,
        title: w.display_name ?? "Untitled",
        url: w.doi ? `https://doi.org/${w.doi.replace("https://doi.org/", "")}` : w.id,
        publishedAt: w.publication_date ? new Date(w.publication_date) : null, // never fabricate a publish date
        authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
        doi: w.doi?.replace("https://doi.org/", ""),
        categories: (w.concepts ?? []).slice(0, 5).map((c: any) => c.display_name),
        description: reconstructAbstract(w.abstract_inverted_index)
      }));
    } catch (err) {
      console.error("[openAlexConnector] failed:", err);
      return [];
    }
  }
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** OpenAlex stores abstracts as an inverted index — {word: [position, ...]}
 *  — to save space. Rebuild the plain-text abstract from it; without this,
 *  every OpenAlex paper was being ingested with title + metadata but no
 *  usable text for summarization, ranking, or search. */
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string | undefined {
  if (!invertedIndex) return undefined;

  const positions: { word: string; pos: number }[] = [];
  for (const [word, occurrences] of Object.entries(invertedIndex)) {
    for (const pos of occurrences) positions.push({ word, pos });
  }
  if (positions.length === 0) return undefined;

  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(" ");
}
