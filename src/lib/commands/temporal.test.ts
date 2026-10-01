import { describe, it, expect } from "vitest";
import { parseRelativeDate } from "./temporal";

describe("parseRelativeDate — calendar semantics with IANA timezone", () => {
  // 2026-06-17 12:00 UTC is 2026-06-17 17:30 in India (UTC+5:30) — a Wednesday.
  const nowUtc = new Date("2026-06-17T12:00:00Z");

  it("'yesterday' is the previous CALENDAR day (bounded start and end), not a rolling 24h window", () => {
    const result = parseRelativeDate("what changed yesterday", "Asia/Kolkata", nowUtc);
    // Yesterday in India: 2026-06-16 00:00 IST -> 2026-06-15T18:30:00Z through 2026-06-16T18:30:00Z
    expect(result?.since).toBe(new Date("2026-06-15T18:30:00.000Z").toISOString());
    expect(result?.until).toBe(new Date("2026-06-16T18:30:00.000Z").toISOString());
  });

  it("'today' is the start of the current calendar day in the user's timezone, open through now", () => {
    const result = parseRelativeDate("what changed today", "Asia/Kolkata", nowUtc);
    expect(result?.since).toBe(new Date("2026-06-16T18:30:00.000Z").toISOString());
    expect(result?.until).toBeNull();
  });

  it("'this week' resolves to the most recent Monday's local midnight (Wednesday case)", () => {
    // Most recent Monday before 2026-06-17 (Wed) is 2026-06-15.
    const result = parseRelativeDate("what changed this week", "Asia/Kolkata", nowUtc);
    expect(result?.since).toBe(new Date("2026-06-14T18:30:00.000Z").toISOString()); // 2026-06-15 00:00 IST
    expect(result?.until).toBeNull();
  });

  it("'this week' on a Monday means today, not a week further back (Sunday->Monday transition)", () => {
    // 2026-06-15 is itself a Monday.
    const mondayNoonUtc = new Date("2026-06-15T12:00:00Z");
    const result = parseRelativeDate("what changed this week", "Asia/Kolkata", mondayNoonUtc);
    expect(result?.since).toBe(new Date("2026-06-14T18:30:00.000Z").toISOString()); // that same Monday's local midnight
  });

  it("'since Monday' resolves the same way as 'this week' for a mid-week query", () => {
    const result = parseRelativeDate("what's new since monday", "Asia/Kolkata", nowUtc);
    expect(result?.since).toBe(new Date("2026-06-14T18:30:00.000Z").toISOString());
    expect(result?.until).toBeNull();
  });

  it("'last N days' keeps ROLLING semantics (not a calendar boundary) even with a timezone given", () => {
    const result = parseRelativeDate("what happened in the last 3 days", "Asia/Kolkata", nowUtc);
    expect(result?.since).toBe(new Date(nowUtc.getTime() - 3 * 86_400_000).toISOString());
    expect(result?.until).toBeNull();
  });

  it("'last 24 hours' keeps rolling semantics", () => {
    const result = parseRelativeDate("show me the last 24 hours", "Asia/Kolkata", nowUtc);
    expect(result?.since).toBe(new Date(nowUtc.getTime() - 86_400_000).toISOString());
  });

  it("handles a query near local midnight correctly (date-boundary edge case)", () => {
    // 2026-06-17T18:35:00Z = 2026-06-18T00:05 IST — just past local midnight.
    const justAfterMidnightIst = new Date("2026-06-17T18:35:00Z");
    const result = parseRelativeDate("what changed today", "Asia/Kolkata", justAfterMidnightIst);
    // "Today" should be 2026-06-18 00:00 IST, not 2026-06-17.
    expect(result?.since).toBe(new Date("2026-06-17T18:30:00.000Z").toISOString());
  });

  it("falls back to UTC for an unknown/invalid timezone rather than throwing", () => {
    expect(() => parseRelativeDate("what changed today", "Not/A_Zone", nowUtc)).not.toThrow();
  });

  it("returns null when the utterance names no date", () => {
    expect(parseRelativeDate("show me SSM research", "UTC", nowUtc)).toBeNull();
  });

  it("produces a valid window for a combined topic+temporal phrase ('SSM research this week')", () => {
    // temporal.ts only resolves the window itself; parser.ts is what attaches
    // it to the topic_research intent — see parser.test.ts for that
    // end-to-end case. This just confirms the window resolves correctly in
    // isolation for the exact phrase used there.
    const result = parseRelativeDate("show me new ssm research this week", "Asia/Kolkata", nowUtc);
    expect(result?.since).toBe(new Date("2026-06-14T18:30:00.000Z").toISOString());
  });
});
