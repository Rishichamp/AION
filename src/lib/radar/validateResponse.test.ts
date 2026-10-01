import { describe, it, expect } from "vitest";
import { validateRadarResponse } from "./validateResponse";
import type { RadarCandidate } from "./candidates";

function candidate(overrides: Partial<RadarCandidate>): RadarCandidate {
  return {
    candidateId: "article:1",
    kind: "article",
    dbId: "1",
    title: "Title",
    url: "https://example.com",
    publishedAt: new Date(),
    discoveredAt: new Date(),
    topicNames: [],
    importance: 0.5,
    relevance: 0.5,
    novelty: 0.5,
    sourceQuality: 0.5,
    previouslySeen: false,
    bookmarked: false,
    ...overrides
  };
}

describe("validateRadarResponse", () => {
  const candidates = [
    candidate({ candidateId: "article:1", kind: "article", dbId: "1" }),
    candidate({ candidateId: "paper:1", kind: "paper", dbId: "p1" }),
    candidate({ candidateId: "paper:2", kind: "paper", dbId: "p2" }),
    candidate({ candidateId: "model:1", kind: "model", dbId: "m1" })
  ];

  it("accepts a valid, well-shaped response", () => {
    const result = validateRadarResponse(
      {
        summary: "Here's what changed.",
        developments: [{ candidateId: "article:1", whyItMatters: "Big deal." }],
        recommendations: [{ candidateId: "paper:1", whyRead: "Worth reading." }]
      },
      candidates
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.summary).toBe("Here's what changed.");
    expect(result.developments).toEqual([{ candidateId: "article:1", reason: "Big deal." }]);
    expect(result.recommendations).toEqual([{ candidateId: "paper:1", reason: "Worth reading." }]);
  });

  it("accepts a genuinely empty response as a valid quiet period (ok:true, not a failure)", () => {
    const result = validateRadarResponse({ summary: "Nothing new.", developments: [], recommendations: [] }, candidates);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.developments).toEqual([]);
  });

  it("FAILS generation (ok:false) for malformed JSON shape (wrong types) — must not become a silent quiet period", () => {
    const result = validateRadarResponse(
      { summary: 12345, developments: "not an array", recommendations: null },
      candidates
    );
    expect(result.ok).toBe(false);
  });

  it("FAILS generation for completely unrelated JSON shape", () => {
    const result = validateRadarResponse({ foo: "bar" }, candidates);
    expect(result.ok).toBe(false);
  });

  it("FAILS generation when every claimed development referenced an invalid candidateId (substantively unusable, not genuinely quiet)", () => {
    const result = validateRadarResponse(
      {
        summary: "s",
        developments: [
          { candidateId: "article:999", whyItMatters: "x" },
          { candidateId: "article:998", whyItMatters: "y" }
        ],
        recommendations: []
      },
      candidates
    );
    expect(result.ok).toBe(false);
  });

  it("FAILS generation for a single development that's the only claimed one and is invalid (zero survivors from non-empty raw)", () => {
    const result = validateRadarResponse(
      { summary: "s", developments: [{ candidateId: "article:999", whyItMatters: "x" }], recommendations: [] },
      candidates
    );
    expect(result.ok).toBe(false);
  });

  it("discards a duplicate candidateId within developments (keeps the first) — still ok:true since one valid survivor exists", () => {
    const result = validateRadarResponse(
      {
        summary: "s",
        developments: [
          { candidateId: "article:1", whyItMatters: "first" },
          { candidateId: "article:1", whyItMatters: "duplicate" }
        ],
        recommendations: []
      },
      candidates
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.developments).toEqual([{ candidateId: "article:1", reason: "first" }]);
  });

  it("discards a recommendation that duplicates an id already used as a development", () => {
    const result = validateRadarResponse(
      {
        summary: "s",
        developments: [{ candidateId: "paper:1", whyItMatters: "shown as development" }],
        recommendations: [{ candidateId: "paper:1", whyRead: "also recommended" }]
      },
      candidates
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.developments).toEqual([{ candidateId: "paper:1", reason: "shown as development" }]);
    expect(result.recommendations).toEqual([]);
  });

  it("rejects a recommendation that references a non-paper candidate (article)", () => {
    const result = validateRadarResponse(
      { summary: "s", developments: [], recommendations: [{ candidateId: "article:1", whyRead: "x" }] },
      candidates
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.recommendations).toEqual([]);
  });

  it("rejects a recommendation that references a non-paper candidate (model)", () => {
    const result = validateRadarResponse(
      { summary: "s", developments: [], recommendations: [{ candidateId: "model:1", whyRead: "x" }] },
      candidates
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.recommendations).toEqual([]);
  });

  it("accepts a recommendation that references a valid paper candidate", () => {
    const result = validateRadarResponse(
      { summary: "s", developments: [], recommendations: [{ candidateId: "paper:2", whyRead: "x" }] },
      candidates
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.recommendations).toEqual([{ candidateId: "paper:2", reason: "x" }]);
  });

  it("FAILS generation for excessively long summary/reason strings via the schema's max length", () => {
    const result = validateRadarResponse(
      {
        summary: "x".repeat(10_000),
        developments: [{ candidateId: "article:1", whyItMatters: "y".repeat(10_000) }],
        recommendations: []
      },
      candidates
    );
    // Schema max() rejects the whole object on an over-length field — this
    // is a shape failure (ok:false), not something silently truncated into
    // a fake quiet period.
    expect(result.ok).toBe(false);
  });

  it("FAILS generation when the raw developments array exceeds the sanity ceiling (10 items)", () => {
    const manyCandidates = Array.from({ length: 15 }, (_, i) => candidate({ candidateId: `article:${i}`, dbId: `${i}` }));
    const result = validateRadarResponse(
      {
        summary: "s",
        developments: Array.from({ length: 15 }, (_, i) => ({ candidateId: `article:${i}`, whyItMatters: "x" })),
        recommendations: []
      },
      manyCandidates
    );
    // z.array().max(10) fails the whole parse for an over-length array
    // (it's a length constraint, not a silent truncation) — correctly a
    // shape failure here, same as any other malformed response.
    expect(result.ok).toBe(false);
  });

  it("succeeds normally when the raw array is within the sanity ceiling", () => {
    const manyCandidates = Array.from({ length: 8 }, (_, i) => candidate({ candidateId: `article:${i}`, dbId: `${i}` }));
    const result = validateRadarResponse(
      {
        summary: "s",
        developments: Array.from({ length: 8 }, (_, i) => ({ candidateId: `article:${i}`, whyItMatters: "x" })),
        recommendations: []
      },
      manyCandidates
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.developments.length).toBe(8);
  });
});
