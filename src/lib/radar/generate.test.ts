import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireRadarLock: vi.fn(),
  releaseRadarLock: vi.fn().mockResolvedValue(undefined),
  findFirst: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  markCheckpoint: vi.fn().mockResolvedValue(undefined),
  getCheckpoint: vi.fn(),
  getCandidatesInWindow: vi.fn(),
  sortByRank: vi.fn(),
  getReadNext: vi.fn(),
  completeJSON: vi.fn(),
  validateRadarResponse: vi.fn(),
  userInterestFindMany: vi.fn().mockResolvedValue([]),
  rankScore: vi.fn(),
  contentFeedbackFindMany: vi.fn().mockResolvedValue([]),
  userFocusFindUnique: vi.fn().mockResolvedValue(null)
}));

vi.mock("./checkpoint", () => ({
  acquireRadarLock: mocks.acquireRadarLock,
  releaseRadarLock: mocks.releaseRadarLock,
  recordRadarRequest: vi.fn().mockResolvedValue(undefined),
  getCheckpoint: mocks.getCheckpoint,
  markCheckpoint: mocks.markCheckpoint
}));

vi.mock("@/lib/db", () => ({
  db: {
    radarBrief: { findFirst: mocks.findFirst, findUnique: vi.fn(), create: mocks.create },
    userInterest: { findMany: mocks.userInterestFindMany },
    contentFeedback: { findMany: mocks.contentFeedbackFindMany },
    userFocus: { findUnique: mocks.userFocusFindUnique },
    $transaction: mocks.transaction
  }
}));

// generate.ts imports several other modules at the top level that aren't
// exercised by every test here — mock them, with a couple exposed as
// configurable spies for the validation-failure workflow test below.
vi.mock("./candidates", () => ({ getCandidatesInWindow: mocks.getCandidatesInWindow, candidateToItemRef: vi.fn() }));
vi.mock("./rank", () => ({ sortByRank: mocks.sortByRank, rankScore: mocks.rankScore }));
vi.mock("./readNext", () => ({ getReadNext: mocks.getReadNext }));
vi.mock("./behavior", () => ({ getBehavioralTopicBoost: vi.fn().mockResolvedValue(new Map()), mergeInterestSignals: vi.fn((a: any) => a) }));
vi.mock("./validateResponse", () => ({ validateRadarResponse: mocks.validateRadarResponse }));
vi.mock("@/lib/sources/health", () => ({ getOverallFreshness: vi.fn().mockResolvedValue("fresh") }));
vi.mock("@/lib/ai/client", () => ({ completeJSON: mocks.completeJSON }));
vi.mock("@/lib/ai/prompts", () => ({ radarBriefPrompt: vi.fn().mockReturnValue("prompt") }));

import { generateRadarBriefing, RadarInProgressError, RadarGenerationError } from "./generate";

describe("generateRadarBriefing — lock contention never returns unrelated stale data", () => {
  beforeEach(() => {
    mocks.acquireRadarLock.mockReset();
    mocks.findFirst.mockReset();
    vi.useFakeTimers();
  });

  it("throws RadarInProgressError rather than returning an old, unrelated brief when the lock can't be acquired and nothing fresh appeared", async () => {
    mocks.acquireRadarLock.mockResolvedValue(null); // never acquires
    mocks.findFirst.mockResolvedValue(null); // no fresh brief appeared while waiting

    const promise = generateRadarBriefing("user1");
    const assertion = expect(promise).rejects.toThrow(RadarInProgressError);
    // Fast-forward past all the retry delays.
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("returns a brief IF one was created during the wait (genuinely the result of the concurrent request)", async () => {
    mocks.acquireRadarLock.mockResolvedValue(null);
    const freshBrief = { id: "brief1", createdAt: new Date(), items: [] };
    mocks.findFirst.mockResolvedValue(freshBrief);

    const promise = generateRadarBriefing("user1");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(freshBrief);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("generateRadarBriefing — malformed LLM response must fail generation, not persist a fake quiet period", () => {
  beforeEach(() => {
    mocks.acquireRadarLock.mockReset();
    mocks.create.mockReset();
    mocks.transaction.mockReset();
    mocks.markCheckpoint.mockClear();
    mocks.getCheckpoint.mockReset();
    mocks.getCandidatesInWindow.mockReset();
    mocks.sortByRank.mockReset();
    mocks.rankScore.mockReset();
    mocks.getReadNext.mockReset();
    mocks.completeJSON.mockReset();
    mocks.validateRadarResponse.mockReset();
  });

  it("throws RadarGenerationError, never calls db.$transaction (no brief persisted), and never advances the checkpoint", async () => {
    mocks.acquireRadarLock.mockResolvedValue("token-1");
    mocks.getCheckpoint.mockResolvedValue({ from: new Date("2026-01-01"), isFirstRun: false });

    const someCandidate = {
      candidateId: "article:1",
      kind: "article",
      dbId: "1",
      title: "t",
      url: "https://x",
      publishedAt: new Date(),
      discoveredAt: new Date(),
      topicNames: [],
      importance: 0.9,
      relevance: 0.9,
      novelty: 0.5,
      sourceQuality: 0.9,
      previouslySeen: false,
      bookmarked: false
    };
    mocks.getCandidatesInWindow.mockResolvedValue([someCandidate]);
    mocks.sortByRank.mockImplementation((items: any[]) => items);
    mocks.rankScore.mockImplementation((c: any) => c.importance ?? 0);
    mocks.getReadNext.mockResolvedValue([]); // no papers, doesn't matter for this test
    mocks.completeJSON.mockResolvedValue({ garbage: true }); // malformed shape
    mocks.validateRadarResponse.mockReturnValue({ ok: false, reason: "malformed" });

    await expect(generateRadarBriefing("user1")).rejects.toThrow(RadarGenerationError);

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.markCheckpoint).not.toHaveBeenCalled();
    // Lock must still be released even though generation failed, so a
    // retry isn't blocked by a lock the failed request forgot to clean up.
    expect(mocks.releaseRadarLock).toHaveBeenCalledWith("user1", "token-1");
  });
});
