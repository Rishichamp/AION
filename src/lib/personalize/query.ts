// Pure text helpers for the search box and the "what I'm looking for" field.
// No DB, no network, no LLM — deterministic and free-tier friendly.
import { TOPICS } from "@/lib/topics/config";

export type ContentType = "paper" | "article" | "model" | "project";

export type ParsedRequest = {
  /** Single significant words, lowercased. */
  terms: string[];
  /** Quoted phrases, lowercased: "state space model" */
  phrases: string[];
  /** Words/phrases prefixed with "-": must NOT appear. */
  exclude: string[];
  /** Content types implied by the wording ("papers", "repos", "news"...). Empty = all. */
  types: ContentType[];
};

const STOPWORDS = new Set(
  ("a an the of and or for to in on with about from by at as is are be that this these those it its " +
    "me my i we you show find give get list any some all latest new recent recently newest " +
    "please want need looking look interested").split(/\s+/)
);

const TYPE_WORDS: Record<string, ContentType> = {
  paper: "paper", papers: "paper", research: "paper", arxiv: "paper", study: "paper", studies: "paper",
  news: "article", article: "article", articles: "article", blog: "article", announcement: "article", announcements: "article",
  model: "model", models: "model", checkpoint: "model", checkpoints: "model",
  repo: "project", repos: "project", github: "project", project: "project", projects: "project", library: "project", libraries: "project", tool: "project", tools: "project"
};

export function parseRequest(input: string): ParsedRequest {
  const text = (input ?? "").toLowerCase();
  const phrases: string[] = [];
  const exclude: string[] = [];

  // "quoted phrases" (and -"quoted phrases")
  let rest = text.replace(/(-?)"([^"]+)"/g, (_m, neg: string, phrase: string) => {
    const p = phrase.trim().replace(/\s+/g, " ");
    if (p) (neg ? exclude : phrases).push(p);
    return " ";
  });

  const terms: string[] = [];
  const types: ContentType[] = [];

  for (const raw of rest.split(/[\s,;]+/)) {
    if (!raw) continue;
    if (raw.startsWith("-") && raw.length > 2) {
      exclude.push(raw.slice(1).replace(/[^a-z0-9.+#-]/g, ""));
      continue;
    }
    const w = raw.replace(/[^a-z0-9.+#-]/g, "").replace(/^[.-]+|[.-]+$/g, "");
    if (!w) continue;
    const type = TYPE_WORDS[w];
    if (type) {
      if (!types.includes(type)) types.push(type);
      continue; // a type word narrows the search; it isn't a content keyword
    }
    if (STOPWORDS.has(w) || w.length < 2) continue;
    if (!terms.includes(w)) terms.push(w);
  }

  return { terms, phrases, exclude: exclude.filter(Boolean), types };
}

/** Adds topic aliases so "ssm" also finds "state space models"/"mamba", and
 *  "llm" also finds "large language models". Returns lowercase alternatives
 *  for a single term/phrase (always includes the original). */
export function expandWithAliases(termOrPhrase: string): string[] {
  const t = termOrPhrase.toLowerCase();
  const out = new Set([t]);
  for (const topic of TOPICS) {
    if (topic.ambiguous) continue; // never expand ambiguous placeholder topics
    const names = [topic.name.toLowerCase(), ...topic.aliases];
    if (names.includes(t)) for (const n of names) out.add(n);
  }
  return [...out];
}

export type SearchableFields = {
  title?: string | null;
  topics?: string[];
  summary?: string | null;
  people?: string | null; // authors / organization
  body?: string | null;
};

const FIELD_WEIGHT = { title: 5, topics: 3, summary: 2, people: 2, body: 1 } as const;

export type TextScore = { score: number; matched: string[]; allTermsMatched: boolean; excluded: boolean };

/** Scores one item against a parsed request. Title hits count most; phrase
 *  hits get a bonus; excluded words hard-reject. */
export function scoreText(fields: SearchableFields, req: ParsedRequest): TextScore {
  const hay = {
    title: (fields.title ?? "").toLowerCase(),
    topics: (fields.topics ?? []).join(" ").toLowerCase(),
    summary: (fields.summary ?? "").toLowerCase(),
    people: (fields.people ?? "").toLowerCase(),
    body: (fields.body ?? "").toLowerCase()
  };
  const all = Object.values(hay).join(" \n ");

  for (const ex of req.exclude) {
    if (ex && new RegExp(`(^|[^a-z0-9])${escapeRe(ex)}([^a-z0-9]|$)`).test(all)) {
      return { score: 0, matched: [], allTermsMatched: false, excluded: true };
    }
  }

  let score = 0;
  const matched: string[] = [];
  let hits = 0;

  const units = [...req.terms.map((t) => ({ label: t, alts: expandWithAliases(t), phrase: false })), ...req.phrases.map((p) => ({ label: p, alts: expandWithAliases(p), phrase: true }))];

  for (const unit of units) {
    let best = 0;
    for (const alt of unit.alts) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(alt)}`, "i"); // word-start match: "diffus" matches "diffusion"
      for (const [field, w] of Object.entries(FIELD_WEIGHT) as [keyof typeof FIELD_WEIGHT, number][]) {
        if (re.test(hay[field])) best = Math.max(best, w * (alt === unit.label ? 1 : 0.85) * (unit.phrase ? 1.5 : 1));
      }
    }
    if (best > 0) {
      score += best;
      hits++;
      matched.push(unit.label);
    }
  }

  return { score, matched, allTermsMatched: units.length > 0 && hits === units.length, excluded: false };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared with rankList.ts and Radar's generate.ts so "what I'm looking for"
// nudges ranking the same amount everywhere it's applied, rather than each
// call site inventing its own magnitude.
export const FOCUS_BOOST_FACTOR = 0.6;
export const MAX_TEXT_SCORE = 12; // empirical ceiling of scoreText's weighted field-hit sum, used to normalize to 0..1

/** null return means "hard-excluded by the focus text" (a "-word" hit) —
 *  the caller should drop the item rather than apply any multiplier. */
export function focusMultiplier(fields: SearchableFields, req: ParsedRequest | null): number | null {
  if (!req || req.terms.length + req.phrases.length + req.exclude.length === 0) return 1;
  const result = scoreText(fields, req);
  if (result.excluded) return null;
  return 1 + FOCUS_BOOST_FACTOR * Math.min(1, result.score / MAX_TEXT_SCORE);
}

/** Every distinct search unit (terms + phrases) — used to build DB filters. */
export function searchUnits(req: ParsedRequest): string[] {
  const set = new Set<string>();
  for (const u of [...req.terms, ...req.phrases]) for (const alt of expandWithAliases(u)) set.add(alt);
  return [...set];
}

/** Type hint → which tables to query. Empty = all four. */
export function targetTypes(req: ParsedRequest): ContentType[] {
  return req.types.length > 0 ? req.types : ["paper", "article", "model", "project"];
}
