import { describe, it, expect } from "vitest";
import { canonicalUrl, titleSimilarity, TITLE_SIMILARITY_THRESHOLD } from "./dedupe";

describe("canonicalUrl", () => {
  it("strips utm/tracking params", () => {
    expect(canonicalUrl("https://example.com/post?utm_source=x&utm_medium=y")).toBe("example.com/post");
  });

  it("strips a trailing slash", () => {
    expect(canonicalUrl("https://example.com/post/")).toBe("example.com/post");
  });

  it("is case-insensitive", () => {
    expect(canonicalUrl("https://Example.com/Post")).toBe(canonicalUrl("https://example.com/Post"));
  });

  it("keeps non-tracking query params", () => {
    expect(canonicalUrl("https://example.com/post?id=42")).toBe("example.com/post?id=42");
  });

  it("falls back to trimmed lowercase on an unparseable URL", () => {
    expect(canonicalUrl("Not A URL")).toBe("not a url");
  });
});

describe("titleSimilarity", () => {
  it("scores identical titles as 1", () => {
    expect(titleSimilarity("Attention Is All You Need", "Attention Is All You Need")).toBe(1);
  });

  it("scores completely different titles near 0", () => {
    expect(titleSimilarity("Attention Is All You Need", "Robotic Arm Control Systems")).toBeLessThan(0.2);
  });

  it("scores near-duplicate titles (same story, different source wording) above the dedup threshold", () => {
    const score = titleSimilarity(
      "OpenAI releases new reasoning model",
      "OpenAI Releases New Reasoning Model Today"
    );
    expect(score).toBeGreaterThanOrEqual(TITLE_SIMILARITY_THRESHOLD);
  });

  it("returns 0 for empty input rather than throwing", () => {
    expect(titleSimilarity("", "something")).toBe(0);
  });
});
