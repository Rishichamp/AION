import { completeJSON } from "@/lib/ai/client";
import { intentFallbackPrompt } from "@/lib/ai/prompts";
import { matchTopic } from "@/lib/topics/config";
import { parseRelativeDate } from "./temporal";

export type Intent =
  | "since_last_check"
  | "today"
  | "recent_research"
  | "topic_research"
  | "recommendations"
  | "model_releases"
  | "ai_news"
  | "open_source"
  | "daily_brief"
  | "search"
  | "unknown";

export type ParsedCommand = {
  intent: Intent;
  topicSlug: string | null;
  /** ISO date — start of the window this command asked about ("yesterday",
   *  "this week", "since Monday", "last 24 hours"...), resolved as a genuine
   *  CALENDAR boundary in the user's IANA timezone where the phrase implies
   *  one (see lib/commands/temporal.ts). Null means "use the intent's own
   *  default window". */
  sinceDate: string | null;
  /** ISO date — end of the window, or null for "open through now". Only
   *  ever set for calendar-bounded phrases like "yesterday" (a specific
   *  past calendar day, not "yesterday through now"). */
  untilDate: string | null;
  rawQuery: string;
};

const TEMPORAL_PATTERN = /\btoday\b|yesterday|this week|last (24|twenty[- ]four) hours?|last \d+ days?|since (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/;

/**
 * Fast rule-based pass covering the deterministic intent set. A temporal
 * phrase ("this week", "yesterday", ...) can modify ANY of these intents —
 * "show me new SSM research this week" must resolve to topic_research with
 * a sinceDate attached, not fall into the generic "today" bucket just
 * because it also happens to contain "this week". So every specific-content
 * pattern below is checked BEFORE the generic date-only fallback, and every
 * branch attaches the same window regardless of which one matched.
 *
 * `timezone`: the user's stored IANA timezone (see User.timezone), preferred
 * over a raw browser UTC-offset for calendar semantics — an offset alone
 * can't correctly answer "what was midnight three days ago" across a DST
 * transition, and doesn't identify a specific calendar the way a real IANA
 * zone does. Defaults to "UTC" if unknown.
 *
 * Falls back to the LLM only when nothing matches — see README's
 * cost-optimization notes, most commands should never touch an API call.
 */
export async function parseCommand(utteranceRaw: string, timezone: string = "UTC"): Promise<ParsedCommand> {
  const utterance = utteranceRaw.trim().toLowerCase();
  const window = parseRelativeDate(utterance, timezone);
  const topic = matchTopic(utterance);

  if (/what('?s| is| changed).*(since (my |i )?last check|since last time)/.test(utterance)) {
    return withWindow("since_last_check", utteranceRaw, window);
  }
  if (/daily (ai )?brief|today's brief/.test(utterance)) {
    return withWindow("daily_brief", utteranceRaw, window);
  }
  if (/what (should i|to) read|recommend|read next|worth reading/.test(utterance)) {
    return withWindow("recommendations", utteranceRaw, window, topic?.slug ?? null);
  }
  if (/model release|new (ai )?models?\b/.test(utterance)) {
    return withWindow("model_releases", utteranceRaw, window);
  }
  if (/open.?source/.test(utterance)) {
    return withWindow("open_source", utteranceRaw, window);
  }
  if (/\bnews\b/.test(utterance) && !/research|paper/.test(utterance)) {
    return withWindow("ai_news", utteranceRaw, window);
  }

  // Topic-specific research: alias-resolved (see lib/topics/config.ts), so
  // "state space models" / "SSM" / "mamba" all resolve to the same topic.
  // Checked before the generic temporal fallback so a date modifier never
  // swallows the topic ("SSM research this week" must stay topic-specific).
  if (topic) {
    return withWindow("topic_research", utteranceRaw, window, topic.slug);
  }

  if (/recent (research|papers?)|new (research|papers?)/.test(utterance)) {
    return withWindow("recent_research", utteranceRaw, window);
  }

  // Nothing content-specific matched — a bare date reference ("what changed
  // today", "what happened yesterday") is a legitimate generic query.
  if (TEMPORAL_PATTERN.test(utterance)) {
    return withWindow("today", utteranceRaw, window);
  }

  if (/search|find/.test(utterance)) {
    return base("search", utteranceRaw);
  }

  // Nothing matched a cheap rule — ask the LLM once, and still try to
  // resolve any topic it names through the same alias config (never let the
  // LLM invent what an ambiguous term like "OKF" means).
  try {
    const ai = await completeJSON<{ intent: Intent; topic: string | null; sinceDate: string | null }>(
      intentFallbackPrompt(utteranceRaw)
    );
    const aiTopic = ai.topic ? matchTopic(ai.topic) : null;
    return {
      intent: ai.intent,
      topicSlug: aiTopic?.slug ?? null,
      sinceDate: ai.sinceDate ?? window?.since ?? null,
      untilDate: window?.until ?? null,
      rawQuery: utteranceRaw
    };
  } catch (err) {
    console.error("[parseCommand] LLM fallback failed:", err);
    return base("unknown", utteranceRaw);
  }
}

function base(intent: Intent, rawQuery: string): ParsedCommand {
  return { intent, topicSlug: null, sinceDate: null, untilDate: null, rawQuery };
}

function withWindow(
  intent: Intent,
  rawQuery: string,
  window: { since: string; until: string | null } | null,
  topicSlug: string | null = null
): ParsedCommand {
  return { intent, topicSlug, sinceDate: window?.since ?? null, untilDate: window?.until ?? null, rawQuery };
}
