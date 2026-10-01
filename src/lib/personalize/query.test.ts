import { describe, it, expect } from "vitest";
import { parseRequest, scoreText, focusMultiplier, expandWithAliases } from "./query";

describe("parseRequest", () => {
  it("splits plain words, lowercases, and drops stopwords", () => {
    const r = parseRequest("Show me the latest Reasoning breakthroughs");
    expect(r.terms).toEqual(["reasoning", "breakthroughs"]);
  });

  it("extracts quoted phrases separately from single terms", () => {
    const r = parseRequest('agentic coding "state space model"');
    expect(r.terms).toEqual(["agentic", "coding"]);
    expect(r.phrases).toEqual(["state space model"]);
  });

  it("treats -word as an exclusion, not a search term", () => {
    const r = parseRequest("llm inference -crypto -\"web3 tokens\"");
    expect(r.terms).toEqual(["llm", "inference"]);
    expect(r.exclude).toContain("crypto");
    expect(r.exclude).toContain("web3 tokens");
  });

  it("recognizes content-type words without treating them as keywords", () => {
    const r = parseRequest("show me papers about diffusion");
    expect(r.types).toEqual(["paper"]);
    expect(r.terms).not.toContain("papers");
    expect(r.terms).toContain("diffusion");
  });

  it("returns empty arrays for an empty or whitespace-only request", () => {
    const r = parseRequest("   ");
    expect(r.terms).toEqual([]);
    expect(r.phrases).toEqual([]);
    expect(r.exclude).toEqual([]);
  });
});

describe("expandWithAliases", () => {
  it("expands a known alias to its topic's full alias set", () => {
    const alts = expandWithAliases("llm");
    expect(alts).toContain("llm");
    expect(alts).toContain("large language models");
  });

  it("never expands an ambiguous placeholder topic's alias", () => {
    const alts = expandWithAliases("som");
    expect(alts).toEqual(["som"]);
  });

  it("passes through an unrecognized word unchanged", () => {
    expect(expandWithAliases("banana")).toEqual(["banana"]);
  });
});

describe("scoreText", () => {
  const fields = { title: "New Mamba-style State Space Model for Long Context", topics: ["SSMs"], summary: "A selective SSM architecture." };

  it("scores a title hit higher than a body-only hit", () => {
    const titleHit = scoreText({ title: "diffusion models for video", topics: [] }, parseRequest("diffusion"));
    const bodyHit = scoreText({ title: "unrelated", topics: [], body: "this paper touches on diffusion briefly" }, parseRequest("diffusion"));
    expect(titleHit.score).toBeGreaterThan(bodyHit.score);
  });

  it("matches via topic alias expansion (ssm -> state space model)", () => {
    const r = scoreText(fields, parseRequest("ssm"));
    expect(r.score).toBeGreaterThan(0);
    expect(r.matched).toContain("ssm");
  });

  it("hard-excludes when an excluded word appears anywhere", () => {
    const r = scoreText(fields, parseRequest("state space -mamba"));
    expect(r.excluded).toBe(true);
    expect(r.score).toBe(0);
  });

  it("scores zero and unmatched when nothing overlaps", () => {
    const r = scoreText(fields, parseRequest("robotics manipulation"));
    expect(r.score).toBe(0);
    expect(r.allTermsMatched).toBe(false);
  });
});

describe("focusMultiplier", () => {
  const fields = { title: "Agentic coding assistants for large codebases", topics: ["AI Agents"] };

  it("returns exactly 1 (no-op) when there is no active request", () => {
    expect(focusMultiplier(fields, null)).toBe(1);
    expect(focusMultiplier(fields, parseRequest(""))).toBe(1);
  });

  it("returns > 1 when the item matches the focus", () => {
    const m = focusMultiplier(fields, parseRequest("agentic coding"));
    expect(m).not.toBeNull();
    expect(m as number).toBeGreaterThan(1);
  });

  it("returns null (hard exclude) when the item hits an excluded word", () => {
    expect(focusMultiplier(fields, parseRequest("coding -agentic"))).toBeNull();
  });
});
