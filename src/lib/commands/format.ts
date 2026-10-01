export type CommandItem = {
  title: string;
  url: string;
  whyItMatters?: string;
  publishedAt?: Date | string | null;
  itemRef?: { articleId?: string; paperId?: string; modelId?: string; projectId?: string };
};

export type CommandResult = {
  type: string;
  headline: string;
  summary?: string;
  items: CommandItem[];
  spokenText: string;
};

const MAX_SPOKEN_ITEMS = 3;

/** Builds the uniform shape every non-radar command returns. No LLM call
 *  here — see README's cost-optimization notes: simple commands format
 *  already-cached per-item fields (aiSummary/keyPoint/keyContribution)
 *  instead of asking the model to re-describe things it already described
 *  once at ingestion time. */
export function buildListResult(type: string, headline: string, items: CommandItem[], emptyMessage: string): CommandResult {
  if (items.length === 0) {
    return { type, headline: emptyMessage, items: [], spokenText: emptyMessage };
  }

  const spoken = [
    headline,
    ...items.slice(0, MAX_SPOKEN_ITEMS).map((it, i) => `${i + 1}. ${it.title}.${it.whyItMatters ? ` ${it.whyItMatters}` : ""}`)
  ].join(" ");

  return { type, headline, items, spokenText: truncate(spoken, 900) };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}
