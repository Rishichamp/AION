import { localCalendarDayBoundsUtc, localDayOfWeek } from "@/lib/timezone";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type TemporalWindow = { since: string; until: string | null };

/**
 * Resolves a temporal phrase to a window, using genuine CALENDAR semantics
 * in the user's IANA timezone where the phrase implies one — "yesterday" is
 * the previous calendar day (bounded start AND end), not a rolling 24
 * hours; "today"/"this week"/"since <weekday>" are calendar-boundary starts
 * open through now. "last N days"/"last 24 hours" deliberately keep
 * rolling-duration semantics — that's what "last N days" means in ordinary
 * usage, unlike "yesterday" or "this week" which name a specific calendar
 * period.
 *
 * Returns null if the utterance doesn't name a window at all — callers fall
 * back to their own intent-specific default.
 */
export function parseRelativeDate(utterance: string, timezone: string, now: Date = new Date()): TemporalWindow | null {
  const text = utterance.toLowerCase();

  if (/yesterday/.test(text)) {
    const { start, end } = localCalendarDayBoundsUtc(timezone, -1, now);
    return { since: start.toISOString(), until: end.toISOString() };
  }
  if (/\btoday\b/.test(text)) {
    const { start } = localCalendarDayBoundsUtc(timezone, 0, now);
    return { since: start.toISOString(), until: null };
  }
  if (/last (24|twenty[- ]four) hours?/.test(text)) {
    return { since: new Date(now.getTime() - DAY_MS).toISOString(), until: null };
  }
  const lastNDays = text.match(/last (\d+) days?/);
  if (lastNDays) {
    return { since: new Date(now.getTime() - Number(lastNDays[1]) * DAY_MS).toISOString(), until: null };
  }
  if (/this week/.test(text)) {
    return { since: mostRecentMonday(timezone, now).toISOString(), until: null };
  }
  const sinceWeekday = text.match(/since (sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (sinceWeekday) {
    return { since: mostRecentWeekday(timezone, sinceWeekday[1], now).toISOString(), until: null };
  }

  return null;
}

/** Most recent Monday's local midnight — "this week" is Monday-based. */
function mostRecentMonday(timezone: string, now: Date): Date {
  const dow = localDayOfWeek(timezone, now); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  return localCalendarDayBoundsUtc(timezone, -daysSinceMonday, now).start;
}

function mostRecentWeekday(timezone: string, name: string, now: Date): Date {
  const target = WEEKDAYS.indexOf(name); // 0=Sun..6=Sat, matches localDayOfWeek's convention
  const dow = localDayOfWeek(timezone, now);
  const diff = (dow - target + 7) % 7;
  return localCalendarDayBoundsUtc(timezone, -diff, now).start;
}
