import { completeJSON } from "@/lib/ai/client";
import { scorePrompt, summarizePrompt, enrichPrompt } from "@/lib/ai/prompts";
import { isAIQuotaError } from "@/lib/ai/errors";
import { TOPICS, matchTopic } from "@/lib/topics/config";
// Single source of truth for topic names — the alias config in
// lib/topics/config.ts. Kept as a re-export so existing imports don't churn.
export const KNOWN_TOPICS = TOPICS.map((t) => t.name);
const NON_AMBIGUOUS_TOPICS = TOPICS.filter((t) => !t.ambiguous).map((t) => t.name);

/** Source-quality prior used as a scoring input; primary/official sources rank higher. */
export const SOURCE_QUALITY: Record<string, number> = {
  arXiv: 0.9,
  OpenAlex: 0.75,
  GitHub: 0.7,
  "OpenAI Blog": 0.95,
  "Google DeepMind Blog": 0.95,
  "Anthropic News": 0.95,
  "Meta AI Blog": 0.9,
  "Microsoft Research Blog": 0.85,
  "NVIDIA AI Blog": 0.8,
  "Hugging Face Blog": 0.8
};

export async function summarizeAndTag(title: string, body: string) {
  try {
    const result = await completeJSON<{ summary: string; keyPoint: string; topics: string[] }>(
      summarizePrompt(title, body)
    );
    // Ambiguous topics (OKF/SOM/CAG/MAG — see lib/topics/config.ts) are only
    // ever attached via explicit alias match against the source text, never
    // because the LLM decided to apply the label — the LLM's prompt already
    // excludes them from its tagging menu, this is a hard backstop.
    const aliasMatch = matchTopic(`${title} ${body}`);
    const topics = new Set(result.topics.filter((t) => NON_AMBIGUOUS_TOPICS.includes(t)));
    if (aliasMatch) topics.add(aliasMatch.name);
    return { ...result, topics: [...topics] };
  } catch (err) {
    console.error("[classify] summarization failed, falling back to heuristic:", err);
    const aliasMatch = matchTopic(`${title} ${body}`);
    return {
      summary: body.slice(0, 220),
      keyPoint: title,
      topics: aliasMatch ? [aliasMatch.name] : []
    };
  }
}

export async function scoreItem(title: string, summary: string, sourceName: string) {
  const sourceQuality = SOURCE_QUALITY[sourceName] ?? 0.5;
  try {
    return await completeJSON<{ importance: number; novelty: number; relevance: number }>(
      scorePrompt(title, summary, sourceQuality)
    );
  } catch (err) {
    console.error("[classify] scoring failed, falling back to source-quality heuristic:", err);
    return { importance: sourceQuality, novelty: 0.5, relevance: sourceQuality };
  }
}

const MIN_BODY_LENGTH_FOR_LLM = 60;
const LOW_QUALITY_SOURCE_THRESHOLD = 0.7;

/** Cheap, deterministic gate run BEFORE any LLM call — see README's cost
 *  notes. An item skips the LLM entirely when it's thin (little to actually
 *  summarize), from a lower-quality source, AND doesn't even superficially
 *  match a known topic alias. Ingestion still stores it (never silently
 *  drop content), just without paying for a summary/score nobody's likely
 *  to need. */
export function shouldSkipLLM(title: string, body: string, sourceName: string): boolean {
  const sourceQuality = SOURCE_QUALITY[sourceName] ?? 0.5;
  const thin = body.trim().length < MIN_BODY_LENGTH_FOR_LLM;
  const lowQualitySource = sourceQuality < LOW_QUALITY_SOURCE_THRESHOLD;
  const hasTopicSignal = matchTopic(`${title} ${body}`) !== null;
  return thin && lowQualitySource && !hasTopicSignal;
}

/** Deterministic classification used when shouldSkipLLM() is true — no
 *  network call, just heuristics. */
export function heuristicClassify(title: string, body: string, sourceName: string) {
  const sourceQuality = SOURCE_QUALITY[sourceName] ?? 0.5;
  const aliasMatch = matchTopic(`${title} ${body}`);
  return {
    summary: body.slice(0, 220) || title,
    keyPoint: title,
    topics: aliasMatch ? [aliasMatch.name] : [],
    importance: sourceQuality,
    novelty: 0.4,
    relevance: sourceQuality
  };
}

// ---------- free-tier-aware LLM use ----------
// The pipeline used to make TWO LLM calls per item, for every item. A free
// Gemini key allows ~5/minute and ~20/day, so that can never work. Now:
//   * one combined call per item (summary + tags + scores)
//   * a per-run allowance (see setLlmAllowance) — only the first N eligible
//     items per source get the LLM; the rest use heuristicClassify()
//   * the first AIQuotaError switches the LLM off for the rest of the process
let llmAllowance = Infinity;
let llmDisabled = false;

export function setLlmAllowance(n: number) {
  llmAllowance = n;
}
export function llmEnabled() {
  return !llmDisabled && llmAllowance > 0;
}

const clamp01 = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

/** One LLM call → summary, keyPoint, topics, importance, novelty, relevance.
 *  Never throws: on quota/any failure it returns the heuristic result. */
export async function enrichItem(title: string, body: string, sourceName: string) {
  llmAllowance -= 1;
  const sourceQuality = SOURCE_QUALITY[sourceName] ?? 0.5;
  try {
    const r = await completeJSON<{
      summary: string;
      keyPoint: string;
      topics: string[];
      importance: number;
      novelty: number;
      relevance: number;
    }>(enrichPrompt(title, body, sourceQuality), { priority: "ingest" });

    const aliasMatch = matchTopic(`${title} ${body}`);
    const topics = new Set((r.topics ?? []).filter((t) => NON_AMBIGUOUS_TOPICS.includes(t)));
    if (aliasMatch) topics.add(aliasMatch.name);

    return {
      summary: r.summary || body.slice(0, 220) || title,
      keyPoint: r.keyPoint || title,
      topics: [...topics],
      importance: clamp01(r.importance, sourceQuality),
      novelty: clamp01(r.novelty, 0.5),
      relevance: clamp01(r.relevance, sourceQuality)
    };
  } catch (err) {
    if (isAIQuotaError(err)) {
      if (!llmDisabled) console.warn(`[classify] AI quota reached — the rest of this run uses heuristics. (${(err as Error).message})`);
      llmDisabled = true;
    } else {
      console.error("[classify] LLM enrich failed, using heuristic:", err instanceof Error ? err.message.slice(0, 200) : err);
    }
    return heuristicClassify(title, body, sourceName);
  }
}
