import { z } from "zod";
import type { RadarCandidate } from "./candidates";

const MAX_REASON_LENGTH = 400;
const MAX_SUMMARY_LENGTH = 600;
const MAX_RAW_ITEMS = 10; // sanity ceiling on what we'll even look at; generate.ts slices further to the real product limits (5/3)

const radarItemSchema = z.object({
  candidateId: z.string().min(1).max(100),
  whyItMatters: z.string().max(MAX_REASON_LENGTH).optional().default("")
});

const radarRecommendationSchema = z.object({
  candidateId: z.string().min(1).max(100),
  whyRead: z.string().max(MAX_REASON_LENGTH).optional().default("")
});

const radarResponseSchema = z.object({
  summary: z.string().max(MAX_SUMMARY_LENGTH),
  developments: z.array(radarItemSchema).max(MAX_RAW_ITEMS),
  recommendations: z.array(radarRecommendationSchema).max(MAX_RAW_ITEMS)
});

export type ValidatedRadarResponse =
  | { ok: true; summary: string; developments: { candidateId: string; reason: string }[]; recommendations: { candidateId: string; reason: string }[] }
  | { ok: false; reason: string };

/**
 * Validates and sanitizes the Radar LLM's structured output. `completeJSON`
 * only proves the response is valid JSON — it says nothing about whether it
 * has the shape we actually asked for. This is that second, more important
 * check, plus the semantic rules the candidate-ID architecture depends on.
 *
 * DETERMINISTIC FAILURE POLICY — read this before changing it:
 * A generation FAILS (`ok: false`) — meaning the caller must not persist a
 * brief or advance the checkpoint — in exactly two cases:
 *   1. The response doesn't even match the schema shape (garbage/malformed
 *      JSON structure).
 *   2. The LLM claimed to report developments (a non-empty `developments`
 *      array) but every single one referenced an invalid candidateId, so
 *      NONE survived validation. That's not a genuine "nothing changed" —
 *      it's the LLM's output having been substantively unusable, and must
 *      not be silently reinterpreted as a quiet period (which would
 *      persist "Nothing major changed" and advance the checkpoint past
 *      real developments the user never actually saw).
 * A genuinely empty response — the LLM explicitly returned
 * `developments: []` — is a legitimate quiet period and returns `ok: true`
 * with empty arrays; generate.ts's own quiet-period messaging handles that
 * case. Partial validity (some entries valid, some discarded — duplicates,
 * unknown ids, non-paper recommendations) also returns `ok: true` with just
 * the valid survivors; discarding individual bad entries is not the same
 * failure mode as the whole response being unusable.
 */
export function validateRadarResponse(raw: unknown, candidates: RadarCandidate[]): ValidatedRadarResponse {
  const parsed = radarResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[validateRadarResponse] malformed LLM response shape:", parsed.error.flatten());
    return { ok: false, reason: "LLM response did not match the expected schema" };
  }

  const byId = new Map(candidates.map((c) => [c.candidateId, c]));
  const seen = new Set<string>();

  const developments: { candidateId: string; reason: string }[] = [];
  for (const d of parsed.data.developments) {
    if (seen.has(d.candidateId)) continue;
    if (!byId.has(d.candidateId)) continue;
    seen.add(d.candidateId);
    developments.push({ candidateId: d.candidateId, reason: d.whyItMatters });
  }

  // The LLM claimed developments existed, but every single one referenced
  // an id outside the supplied candidate set — treat as an unusable
  // response, not a genuine quiet period. See policy note above.
  if (parsed.data.developments.length > 0 && developments.length === 0) {
    return { ok: false, reason: "LLM referenced only invalid/unknown candidateIds for every claimed development" };
  }

  const recommendations: { candidateId: string; reason: string }[] = [];
  for (const r of parsed.data.recommendations) {
    if (seen.has(r.candidateId)) continue; // already used as a development — don't double-count
    const candidate = byId.get(r.candidateId);
    if (!candidate) continue; // unknown id
    if (candidate.kind !== "paper") continue; // recommendations are paper-only
    seen.add(r.candidateId);
    recommendations.push({ candidateId: r.candidateId, reason: r.whyRead });
  }

  return { ok: true, summary: parsed.data.summary, developments, recommendations };
}
