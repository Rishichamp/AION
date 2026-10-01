import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { decayWeight, isNoiseQuery } from "./behavior";

describe("decayWeight", () => {
  const now = new Date("2026-06-17T00:00:00Z");

  it("returns 1.0 for a signal from right now", () => {
    expect(decayWeight(now, now)).toBeCloseTo(1.0, 5);
  });

  it("returns exactly 0.5 at the half-life point (30 days)", () => {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    expect(decayWeight(thirtyDaysAgo, now, 30)).toBeCloseTo(0.5, 5);
  });

  it("returns 0.25 at two half-lives (60 days) — old activity fades, doesn't dominate forever", () => {
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000);
    expect(decayWeight(sixtyDaysAgo, now, 30)).toBeCloseTo(0.25, 5);
  });

  it("recent activity outweighs old activity of the same raw count", () => {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const sixMonthsAgo = new Date(now.getTime() - 180 * 86_400_000);
    expect(decayWeight(yesterday, now)).toBeGreaterThan(decayWeight(sixMonthsAgo, now));
  });

  it("never returns a negative weight for a future-dated signal (clock skew safety)", () => {
    const future = new Date(now.getTime() + 86_400_000);
    expect(decayWeight(future, now)).toBeGreaterThanOrEqual(0);
  });
});

describe("isNoiseQuery", () => {
  it("flags empty and whitespace-only queries as noise", () => {
    expect(isNoiseQuery("")).toBe(true);
    expect(isNoiseQuery("   ")).toBe(true);
  });

  it("flags very short queries as noise", () => {
    expect(isNoiseQuery("ai")).toBe(true);
  });

  it("does not flag a real query as noise", () => {
    expect(isNoiseQuery("state space models")).toBe(false);
  });
});
