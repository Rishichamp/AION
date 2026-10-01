/**
 * Start of the current UTC day, as a Date — used as the DailyBrief.date key.
 * Deliberately UTC, not server-local time: the Daily Brief is a GLOBAL
 * brief (see README), and using `new Date().setHours(0,0,0,0)` would make
 * its date boundary silently depend on whatever TZ the host machine happens
 * to be configured with — fine if the cron job and the web server share a
 * host/TZ, wrong (or just fragile) the moment they don't.
 */
export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Returns the UTC instant corresponding to local midnight for a client whose
 * `Date.getTimezoneOffset()` is `offsetMinutes` (offset = UTC minus local, in
 * minutes — JS's convention, so e.g. UTC-5 reports +300). Used by the "today"
 * command, which gets the offset directly from the browser on each request.
 */
export function localMidnightUtc(offsetMinutes: number, now: Date = new Date()): Date {
  const localNow = new Date(now.getTime() - offsetMinutes * 60_000);
  const localMidnight = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  return new Date(localMidnight + offsetMinutes * 60_000);
}

/**
 * Finds the UTC instant corresponding to local midnight of (y, m, d) in the
 * given IANA timezone, via iterative correction against Intl's actual
 * rendering — robust across DST transitions, unlike fixed-offset math
 * (`localMidnightUtc` above is fine for a browser's single current offset,
 * but doesn't handle "what was midnight on a date 3 days ago" correctly if
 * a DST change happened in between).
 */
function utcForLocalMidnight(timezone: string, y: number, m: number, d: number): Date {
  const targetAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = targetAsUtc;
  for (let i = 0; i < 3; i++) {
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).formatToParts(new Date(guess));
    } catch {
      return new Date(targetAsUtc); // invalid timezone — fall back to treating it as UTC
    }
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const renderedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    // Error is measured against the FIXED target, not the shifting guess —
    // comparing against the guess (the original bug here) never converges,
    // since re-rendering a corrected guess always reproduces the same
    // apparent "offset" relative to itself.
    const error = renderedAsUtc - targetAsUtc;
    if (error === 0) break;
    guess = guess - error;
  }
  return new Date(guess);
}

/**
 * Calendar-day bounds [start, end) in a given IANA timezone, as UTC
 * instants — `dayOffset: 0` is today, `-1` is yesterday, etc. Used for
 * genuine calendar semantics ("yesterday" = the previous calendar day, not
 * a rolling 24 hours) rather than fixed-duration math.
 */
export function localCalendarDayBoundsUtc(timezone: string, dayOffset: number, now: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + dayOffset * 86_400_000);
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(shifted);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(shifted);
    timezone = "UTC";
  }
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  const start = utcForLocalMidnight(timezone, y, m, d);
  const nextDay = new Date(start.getTime() + 25 * 60 * 60 * 1000); // land safely in the next day even across a 23h DST-short day
  const nextParts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(nextDay);
  const end = utcForLocalMidnight(
    timezone,
    Number(nextParts.find((p) => p.type === "year")?.value),
    Number(nextParts.find((p) => p.type === "month")?.value),
    Number(nextParts.find((p) => p.type === "day")?.value)
  );
  return { start, end };
}

/**
 * Local day-of-week (0 = Sunday ... 6 = Saturday) for a given IANA timezone
 * — used to find "the most recent Monday" for "this week"/"since Monday".
 */
export function localDayOfWeek(timezone: string, now: Date = new Date()): number {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  } catch {
    return now.getUTCDay();
  }
}

/**
 * Returns "HH:mm" and the local calendar date "yyyy-mm-dd" for a given IANA
 * timezone — used by /api/push/send to match a user's configured
 * dailyBriefTime and to dedupe so the same local day isn't notified twice.
 * (Server-side, so it needs the IANA name stored on User.timezone rather
 * than a per-request browser offset.)
 */
export function getLocalTime(timezone: string, now: Date = new Date()): { hhmm: string; localDate: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(now);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    return { hhmm: `${get("hour")}:${get("minute")}`, localDate: `${get("year")}-${get("month")}-${get("day")}` };
  } catch {
    // Invalid/unknown timezone string — fall back to UTC rather than throwing.
    return getLocalTime("UTC", now);
  }
}
