import { describe, it, expect } from "vitest";
import { rankAndFilterList, type Listable } from "./rankList";
import { applyFeedbackToInterests, emptySignals } from "./feedbackTypes";
import type { PersonalizationSignals } from "./feedbackTypes";

function item(overrides: Partial<Listable>): Listable {
  return {
    id: "x",
    title: "Untitled",
    topics: [],
    topicNames: [],
    importance: 0.5,
    relevance: 0.5,
    publishedAt: new Date(),
    ...overrides
  };
}

const noSignals = (): PersonalizationSignals => emptySignals();

const noFocus = { request: "", mutedKeywords: [], mutedSources: [] };

describe("rankAndFilterList", () => {
  it("promotes an item that matches the focus request above one that doesn't", () => {
    const pool = [
      item({ id: "a", title: "A survey of database indexing" }),
      item({ id: "b", title: "Agentic coding assistants for large codebases" })
    ];
    const ranked = rankAndFilterList(pool, new Map(), noSignals(), { ...noFocus, request: "agentic coding" }, 10);
    expect(ranked[0].id).toBe("b");
  });

  it("hard-excludes an item matching a muted keyword, even if otherwise top-ranked", () => {
    const pool = [item({ id: "a", title: "Great crypto trading bot", importance: 0.95 }), item({ id: "b", title: "Minor update", importance: 0.1 })];
    const ranked = rankAndFilterList(pool, new Map(), noSignals(), { ...noFocus, mutedKeywords: ["crypto"] }, 10);
    expect(ranked.map((r) => r.id)).toEqual(["b"]);
  });

  it("hard-excludes an item from a muted source", () => {
    const pool = [item({ id: "a", sourceName: "Noisy Blog", importance: 0.9 }), item({ id: "b", sourceName: "Good Blog", importance: 0.1 })];
    const ranked = rankAndFilterList(pool, new Map(), noSignals(), { ...noFocus, mutedSources: ["Noisy Blog"] }, 10);
    expect(ranked.map((r) => r.id)).toEqual(["b"]);
  });

  it("downranks a topic the user marked not-interested via feedback signals", () => {
    const pool = [item({ id: "a", topicNames: ["Robotics"] }), item({ id: "b", topicNames: ["LLMs"] })];
    const signals = { ...noSignals(), topicWeight: new Map([["Robotics", -0.5]]) };
    const interests = new Map([
      ["Robotics", 0.5],
      ["LLMs", 0.5]
    ]);
    const ranked = rankAndFilterList(pool, interests, signals, noFocus, 10);
    expect(ranked[0].id).toBe("b");
  });

  it("respects the limit and applies no ordering change with no signals at all", () => {
    const pool = [item({ id: "a", importance: 0.9 }), item({ id: "b", importance: 0.1 }), item({ id: "c", importance: 0.5 })];
    const ranked = rankAndFilterList(pool, new Map(), noSignals(), noFocus, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].id).toBe("a");
  });
});

describe("applyFeedbackToInterests", () => {
  it("adds feedback weight on top of an existing interest, allowing it to go negative", () => {
    const merged = applyFeedbackToInterests(new Map([["Robotics", 0.2]]), new Map([["Robotics", -0.5]]));
    expect(merged.get("Robotics")).toBeCloseTo(-0.3);
  });

  it("introduces a new topic key that had no prior interest entry", () => {
    const merged = applyFeedbackToInterests(new Map(), new Map([["RAG", 0.3]]));
    expect(merged.get("RAG")).toBe(0.3);
  });
});
