import { describe, it, expect } from "vitest";
import { rankScore, sortByRank } from "./rank";

const base = {
  importance: 0.5,
  novelty: 0.5,
  relevance: 0.5,
  publishedAt: new Date(),
  topicNames: [] as string[],
  sourceQuality: 0.5
};

describe("rankScore", () => {
  it("ranks a more important item higher, all else equal", () => {
    const low = rankScore({ ...base, importance: 0.2 }, new Map());
    const high = rankScore({ ...base, importance: 0.9 }, new Map());
    expect(high).toBeGreaterThan(low);
  });

  it("boosts items matching the user's explicit interests", () => {
    const interests = new Map([["Reasoning", 1]]);
    const matching = rankScore({ ...base, topicNames: ["Reasoning"] }, interests);
    const nonMatching = rankScore({ ...base, topicNames: ["Robotics"] }, interests);
    expect(matching).toBeGreaterThan(nonMatching);
  });

  it("penalizes but does not zero out a previously-seen item (soft filter, not hard exclusion)", () => {
    const unseen = rankScore({ ...base, previouslySeen: false }, new Map());
    const seen = rankScore({ ...base, previouslySeen: true }, new Map());
    expect(seen).toBeGreaterThan(0); // still rankable, never excluded outright
    expect(seen).toBeLessThan(unseen);
  });

  it("penalizes a previously-seen minor item more than a previously-seen major one", () => {
    const seenMinor = rankScore({ ...base, importance: 0.3, previouslySeen: true }, new Map());
    const unseenMinor = rankScore({ ...base, importance: 0.3, previouslySeen: false }, new Map());
    const seenMajor = rankScore({ ...base, importance: 0.95, previouslySeen: true }, new Map());
    const unseenMajor = rankScore({ ...base, importance: 0.95, previouslySeen: false }, new Map());

    const minorPenaltyRatio = seenMinor / unseenMinor;
    const majorPenaltyRatio = seenMajor / unseenMajor;
    expect(majorPenaltyRatio).toBeGreaterThan(minorPenaltyRatio);
  });

  it("boosts a bookmarked item", () => {
    const plain = rankScore({ ...base }, new Map());
    const bookmarked = rankScore({ ...base, bookmarked: true }, new Map());
    expect(bookmarked).toBeGreaterThan(plain);
  });

  it("falls back to discoveredAt for recency when publishedAt is null", () => {
    const recentlyDiscoveredButUndated = rankScore(
      { ...base, publishedAt: null, discoveredAt: new Date() },
      new Map()
    );
    const oldAndUndated = rankScore(
      { ...base, publishedAt: null, discoveredAt: new Date("2000-01-01") },
      new Map()
    );
    expect(recentlyDiscoveredButUndated).toBeGreaterThan(oldAndUndated);
  });
});

describe("sortByRank", () => {
  it("sorts highest score first", () => {
    const items = [
      { ...base, importance: 0.1 },
      { ...base, importance: 0.9 },
      { ...base, importance: 0.5 }
    ];
    const sorted = sortByRank(items, new Map());
    expect(sorted.map((i) => i.importance)).toEqual([0.9, 0.5, 0.1]);
  });
});
