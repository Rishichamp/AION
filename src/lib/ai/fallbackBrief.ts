type BriefItem = { title: string; summary: string; category: string };
const HEADINGS: Record<string, string> = { research: "Research", news: "News", models: "New Models", opensource: "Open Source" };

/** Non-AI daily brief, used when the AI quota is exhausted: groups the day's
 *  top items by category and lists them. Same JSON shape the UI expects. */
export function buildFallbackBrief(items: BriefItem[]) {
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const heading = HEADINGS[it.category] ?? "News";
    const firstSentence = (it.summary ?? "").split(/(?<=[.!?])\s/)[0]?.slice(0, 140);
    const point = firstSentence && firstSentence !== it.title ? `${it.title} — ${firstSentence}` : it.title;
    groups.set(heading, [...(groups.get(heading) ?? []), point]);
  }
  return {
    headline: `${items.length} new AI items today`,
    sections: [...groups.entries()].map(([heading, points]) => ({ heading, points: points.slice(0, 6) }))
  };
}
