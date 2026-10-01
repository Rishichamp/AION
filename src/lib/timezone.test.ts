import { describe, it, expect } from "vitest";
import { localMidnightUtc, getLocalTime, localCalendarDayBoundsUtc, localDayOfWeek } from "./timezone";

describe("localMidnightUtc", () => {
  it("computes local midnight for a UTC-5 offset (offset minutes = +300)", () => {
    // 2026-01-15 10:00 UTC == 2026-01-15 05:00 in UTC-5 -> local midnight was 2026-01-15 05:00 UTC
    const now = new Date("2026-01-15T10:00:00Z");
    const midnight = localMidnightUtc(300, now);
    expect(midnight.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("computes local midnight for a UTC+9 offset (offset minutes = -540)", () => {
    // 2026-01-15 01:00 UTC == 2026-01-15 10:00 in UTC+9 -> local midnight was 2026-01-14 15:00 UTC
    const now = new Date("2026-01-15T01:00:00Z");
    const midnight = localMidnightUtc(-540, now);
    expect(midnight.toISOString()).toBe("2026-01-14T15:00:00.000Z");
  });
});

describe("getLocalTime", () => {
  it("returns the correct HH:mm for a named IANA timezone", () => {
    const now = new Date("2026-06-15T12:30:00Z"); // June -> EDT (UTC-4)
    const { hhmm, localDate } = getLocalTime("America/New_York", now);
    expect(hhmm).toBe("08:30");
    expect(localDate).toBe("2026-06-15");
  });

  it("handles a date-line-crossing timezone", () => {
    const now = new Date("2026-01-15T23:00:00Z");
    const { localDate } = getLocalTime("Pacific/Auckland", now);
    expect(localDate).toBe("2026-01-16");
  });

  it("falls back to UTC for an invalid timezone instead of throwing", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    expect(() => getLocalTime("Not/A_Real_Zone", now)).not.toThrow();
    expect(getLocalTime("Not/A_Real_Zone", now).hhmm).toBe(getLocalTime("UTC", now).hhmm);
  });
});

describe("localCalendarDayBoundsUtc", () => {
  it("computes correct midnight-to-midnight bounds for a constant-offset zone (IST, UTC+5:30)", () => {
    // 2026-06-17 12:00 UTC is 2026-06-17 17:30 IST — same calendar day.
    const now = new Date("2026-06-17T12:00:00Z");
    const { start, end } = localCalendarDayBoundsUtc("Asia/Kolkata", 0, now);
    expect(start.toISOString()).toBe("2026-06-16T18:30:00.000Z"); // 2026-06-17 00:00 IST
    expect(end.toISOString()).toBe("2026-06-17T18:30:00.000Z"); // 2026-06-18 00:00 IST
  });

  it("converges correctly rather than drifting on repeated correction (regression for a real bug)", () => {
    // The original bug compared the correction against the shifting guess
    // instead of the fixed target, causing it to keep over-correcting by
    // the same offset on every iteration instead of converging. This landed
    // ~11 hours off (two offset-corrections deep) instead of the exact
    // midnight instant.
    const { start } = localCalendarDayBoundsUtc("Asia/Kolkata", -2, new Date("2026-06-17T12:00:00Z"));
    // Local midnight of 2026-06-15 in IST.
    expect(start.toISOString()).toBe("2026-06-14T18:30:00.000Z");
  });

  it("handles a negative UTC offset zone (US/Pacific)", () => {
    const now = new Date("2026-01-15T20:00:00Z"); // 12:00 PST same day
    const { start, end } = localCalendarDayBoundsUtc("America/Los_Angeles", 0, now);
    expect(start.toISOString()).toBe("2026-01-15T08:00:00.000Z"); // 2026-01-15 00:00 PST
    expect(end.toISOString()).toBe("2026-01-16T08:00:00.000Z");
  });
});

describe("localDayOfWeek", () => {
  it("returns the correct day-of-week in a timezone ahead of UTC, even when UTC and local disagree on the date", () => {
    // 2026-06-14T20:00:00Z is a Sunday in UTC, but already Monday in IST (+5:30 -> 01:30).
    const sundayLateUtc = new Date("2026-06-14T20:00:00Z");
    expect(localDayOfWeek("Asia/Kolkata", sundayLateUtc)).toBe(1); // Monday
    expect(localDayOfWeek("UTC", sundayLateUtc)).toBe(0); // Sunday
  });
});
