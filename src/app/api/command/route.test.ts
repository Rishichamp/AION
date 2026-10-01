import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  parseCommand: vi.fn(),
  paperFindMany: vi.fn().mockResolvedValue([{ id: "p1", title: "T", url: "https://x", publishedAt: new Date(), keyContribution: "" }]),
  articleFindMany: vi.fn().mockResolvedValue([{ id: "a1", title: "T", url: "https://x", publishedAt: new Date(), keyPoint: "" }]),
  searchLogCreate: vi.fn().mockResolvedValue({})
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/commands/parser", () => ({ parseCommand: mocks.parseCommand }));
vi.mock("@/lib/radar/generate", () => ({
  generateRadarBriefing: vi.fn(),
  RadarInProgressError: class RadarInProgressError extends Error {},
  RadarGenerationError: class RadarGenerationError extends Error {}
}));
vi.mock("@/lib/radar/readNext", () => ({ getReadNext: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/search/fallback", () => ({ targetedWebSearch: vi.fn().mockResolvedValue([]), cacheWebResults: vi.fn() }));
vi.mock("@/lib/search/researchFallback", () => ({ targetedArxivSearch: vi.fn().mockResolvedValue([]), cacheResearchResults: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    researchPaper: { findMany: mocks.paperFindMany },
    article: { findMany: mocks.articleFindMany },
    searchLog: { create: mocks.searchLogCreate },
    modelRelease: { findMany: vi.fn().mockResolvedValue([]) },
    openSourceProject: { findMany: vi.fn().mockResolvedValue([]) },
    dailyBrief: { findUnique: vi.fn().mockResolvedValue(null) }
  }
}));

import { POST } from "./route";

function makeRequest(text: string) {
  return new Request("http://localhost/api/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
}

describe("POST /api/command — topic_research honors the parsed temporal window", () => {
  beforeEach(() => {
    mocks.paperFindMany.mockClear();
    mocks.articleFindMany.mockClear();
    mocks.getCurrentUser.mockResolvedValue({ id: "user1", timezone: "UTC" });
  });

  it("applies sinceDate to the paper AND article queries for 'SSM research this week'", async () => {
    const sinceIso = "2026-06-15T00:00:00.000Z";
    mocks.parseCommand.mockResolvedValue({
      intent: "topic_research",
      topicSlug: "ssms",
      sinceDate: sinceIso,
      untilDate: null,
      rawQuery: "Show me new SSM research this week"
    });

    await POST(makeRequest("Show me new SSM research this week"));

    const paperArgs = mocks.paperFindMany.mock.calls[0][0];
    const articleArgs = mocks.articleFindMany.mock.calls[0][0];

    // Both queries must include a date constraint tied to sinceIso — not
    // just the bare topic filter (the bug: previously sinceDate was parsed
    // but never reached these queries at all).
    expect(JSON.stringify(paperArgs.where)).toContain(sinceIso);
    expect(JSON.stringify(articleArgs.where)).toContain(sinceIso);
    // The topic filter must still be present too — this isn't replacing it.
    expect(JSON.stringify(paperArgs.where)).toContain("ssms");
    expect(JSON.stringify(articleArgs.where)).toContain("ssms");
  });

  it("does not add a date constraint when no temporal phrase was parsed (plain topic browse)", async () => {
    mocks.parseCommand.mockResolvedValue({
      intent: "topic_research",
      topicSlug: "ssms",
      sinceDate: null,
      untilDate: null,
      rawQuery: "Show me SSM research"
    });

    await POST(makeRequest("Show me SSM research"));

    const paperArgs = mocks.paperFindMany.mock.calls[0][0];
    expect(JSON.stringify(paperArgs.where)).not.toContain("publishedAt");
  });
});
