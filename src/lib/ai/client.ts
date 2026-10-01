// A thin, swappable wrapper around whatever LLM provider is configured via
// env vars. Nothing else in the codebase imports an SDK directly — every
// caller goes through complete()/completeJSON() here.
//
// FREE-TIER AWARE: Gemini's free tier is roughly 5 requests/minute and 20
// requests/day per model. This module enforces that locally so the app
// spends its few calls on purpose instead of hammering the API and eating
// 429s:
//   * spaces calls out to stay under the per-minute limit
//   * keeps a per-day counter (persisted in .aion-ai-usage.json, so separate
//     processes like `npm run ingest` and the dev server share it)
//   * reserves part of the daily budget for interactive features
//     (Radar / brief / Ask AION) so ingestion can't starve them
//   * throws AIQuotaError when out of budget, and callers fall back to
//     non-AI behaviour
// Override any limit via env; set AI_RPM=0 / AI_RPD=0 on a paid plan.
import fs from "node:fs";
import path from "node:path";
import { AIQuotaError } from "./errors";

export { AIQuotaError, isAIQuotaError } from "./errors";

type CompleteOptions = {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** "ingest" calls draw from a capped share of the daily budget. Default "interactive". */
  priority?: "ingest" | "interactive";
};

const PROVIDER = process.env.AI_PROVIDER ?? "anthropic";
const API_KEY = process.env.AI_API_KEY ?? "";

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  gemini: "gemini-3.8-flash"
};
const MODEL = process.env.AI_MODEL ?? DEFAULT_MODEL[PROVIDER] ?? DEFAULT_MODEL.anthropic;

// Optional extra models tried (in order) once the primary's daily quota is
// gone. On Gemini's free tier the quota is per model, so a second Flash-class
// model is extra free capacity. e.g. AI_FALLBACK_MODELS="gemini-3.8-flash-lite"
const MODELS = [
  MODEL,
  ...(process.env.AI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
];

const IS_GEMINI = PROVIDER === "gemini";
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);

const RPM = num(process.env.AI_RPM, IS_GEMINI ? 5 : 0); // 0 = unlimited
const RPD = num(process.env.AI_RPD, IS_GEMINI ? 20 : 0); // 0 = unlimited
// How many of the day's calls ingestion may use; the rest stay for Radar/brief/Ask.
const INGEST_DAILY_CAP = num(process.env.AI_INGEST_DAILY_CAP, IS_GEMINI && RPD ? Math.floor(RPD / 2) : 0);

// ---------- persisted usage ----------
const USAGE_FILE = path.join(process.cwd(), ".aion-ai-usage.json");

type Usage = {
  day: string;
  counts: Record<string, number>;
  exhausted: Record<string, boolean>;
  last: Record<string, number>;
  ingest: number;
};

// Gemini's daily quota resets at midnight Pacific time.
function quotaDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function loadUsage(): Usage {
  const fresh: Usage = { day: quotaDay(), counts: {}, exhausted: {}, last: {}, ingest: 0 };
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Usage;
    if (u.day !== fresh.day) return { ...fresh, last: u.last ?? {} };
    return { ...fresh, ...u };
  } catch {
    return fresh;
  }
}

function saveUsage(u: Usage) {
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(u));
  } catch {
    /* read-only FS (e.g. some hosts) — limits still hold in-process via the return value */
  }
}

/** For logging: e.g. "AI calls today: 7/20 (ingestion 5/10)". */
export function aiBudgetStatus(): string {
  const u = loadUsage();
  const used = MODELS.reduce((n, m) => n + (u.counts[m] ?? 0), 0);
  const total = RPD ? RPD * MODELS.length : "∞";
  const ing = INGEST_DAILY_CAP ? `, ingestion ${u.ingest}/${INGEST_DAILY_CAP}` : "";
  return `AI calls today: ${used}/${total}${ing}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Picks a model with budget left and books the call, or throws AIQuotaError. */
function reserve(priority: "ingest" | "interactive"): { model: string; waitMs: number } {
  const u = loadUsage();

  if (priority === "ingest" && INGEST_DAILY_CAP && u.ingest >= INGEST_DAILY_CAP) {
    throw new AIQuotaError(`Ingestion AI budget for today is used up (${u.ingest}/${INGEST_DAILY_CAP}). Falling back to heuristics.`);
  }

  const model = MODELS.find((m) => !u.exhausted[m] && !(RPD && (u.counts[m] ?? 0) >= RPD));
  if (!model) {
    throw new AIQuotaError("Daily free-tier AI quota is used up. It resets at midnight Pacific time.");
  }

  const gap = RPM ? Math.ceil((60_000 / RPM) * 1.08) : 0; // 8% safety margin
  const waitMs = Math.max(0, (u.last[model] ?? 0) + gap - Date.now());

  u.counts[model] = (u.counts[model] ?? 0) + 1;
  if (priority === "ingest") u.ingest += 1;
  u.last[model] = Date.now() + waitMs;
  saveUsage(u);
  return { model, waitMs };
}

function markExhausted(model: string) {
  const u = loadUsage();
  u.exhausted[model] = true;
  saveUsage(u);
}

// ---------- provider calls ----------
class ProviderHttpError extends Error {
  status: number;
  body: string;
  constructor(label: string, status: number, body: string) {
    super(`${label} API error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

function parseRetryDelayMs(body: string): number | null {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? body.match(/retry in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
  if (!API_KEY) {
    throw new Error("AI_API_KEY is not set. AION's AI layer (summaries, scoring, briefings) needs a provider key in .env");
  }
  const priority = opts.priority ?? "interactive";

  for (let attempt = 0; attempt < 3; attempt++) {
    const { model, waitMs } = reserve(priority); // throws AIQuotaError when out of budget
    if (waitMs > 0) await sleep(waitMs);

    try {
      return await callProvider(model, prompt, opts);
    } catch (err) {
      if (!(err instanceof ProviderHttpError)) {
        // Network failure, timeout, etc. — same "fall back, don't crash" treatment.
        throw new AIQuotaError(`AI request failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (err.status === 429) {
        // Daily cap (or a model with no free quota at all): stop using this model today.
        if (/PerDay/i.test(err.body) || /limit:\s*0\b/.test(err.body)) {
          markExhausted(model);
          continue; // try a fallback model, or reserve() throws AIQuotaError
        }
        // Per-minute cap: wait the server's suggested delay, then retry.
        const delay = parseRetryDelayMs(err.body) ?? 30_000;
        if (attempt < 2) {
          await sleep(Math.min(delay + 1000, 65_000));
          continue;
        }
        throw new AIQuotaError("Provider rate limit persisted after retries.", delay);
      }

      if (err.status >= 500 && attempt < 2) {
        await sleep(4000 * (attempt + 1)); // 503 "high demand" spikes are transient
        continue;
      }
      // Persistent 5xx (or any other non-429 HTTP error) after retries: the
      // caller should degrade the same way it does for an exhausted quota —
      // there's no case where re-throwing serves the person better than a
      // ranked-but-not-summarized result.
      throw new AIQuotaError(`Provider unavailable after retries: ${err.message}`);
    }
  }
  throw new AIQuotaError("AI provider unavailable after retries.");
}

async function callProvider(model: string, prompt: string, opts: CompleteOptions): Promise<string> {
  switch (PROVIDER) {
    case "anthropic":
      return completeAnthropic(model, prompt, opts);
    case "openai":
      return completeOpenAICompatible(model, prompt, opts, "https://api.openai.com/v1/chat/completions", "OpenAI");
    case "gemini":
      // Gemini's OpenAI-compatible endpoint — see https://ai.google.dev/gemini-api/docs/openai
      return completeOpenAICompatible(
        model,
        prompt,
        opts,
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "Gemini"
      );
    default:
      throw new Error(`Unknown AI_PROVIDER "${PROVIDER}". Use "anthropic", "openai", or "gemini".`);
  }
}

/** Ask the model for strict JSON and parse it. Retries once on a parse failure. */
export async function completeJSON<T>(prompt: string, opts: CompleteOptions = {}): Promise<T> {
  const system =
    (opts.system ? opts.system + "\n\n" : "") +
    "Respond with ONLY a single valid JSON value. No prose, no markdown fences, no preamble.";

  const raw = await complete(prompt, { ...opts, system });
  try {
    return JSON.parse(stripFences(raw)) as T;
  } catch {
    const retry = await complete(
      prompt + "\n\nYour previous reply was not valid JSON. Reply again with ONLY valid JSON.",
      { ...opts, system }
    );
    try {
      return JSON.parse(stripFences(retry)) as T;
    } catch {
      // Same fallback treatment as a quota/provider failure — the model
      // just never produced usable JSON, twice in a row.
      throw new AIQuotaError("AI response was not valid JSON after a retry.");
    }
  }
}

function stripFences(text: string): string {
  return text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
}

async function completeAnthropic(model: string, prompt: string, opts: CompleteOptions): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
      system: opts.system,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) throw new ProviderHttpError("Anthropic", res.status, await res.text());
  const data = await res.json();
  return data.content?.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text ?? "" : "")).join("") ?? "";
}

async function completeOpenAICompatible(
  model: string,
  prompt: string,
  opts: CompleteOptions,
  endpoint: string,
  label: string
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
      messages: [
        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: prompt }
      ]
    })
  });
  if (!res.ok) throw new ProviderHttpError(label, res.status, await res.text());
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
