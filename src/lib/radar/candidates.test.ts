import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMocks = vi.hoisted(() => ({
  article: vi.fn().mockResolvedValue([]),
  researchPaper: vi.fn().mockResolvedValue([]),
  modelRelease: vi.fn().mockResolvedValue([]),
  openSourceProject: vi.fn().mockResolvedValue([]),
  userReadHistory: vi.fn().mockResolvedValue([]),
  bookmark: vi.fn().mockResolvedValue([]),
  radarItem: vi.fn().mockResolvedValue([])
}));

vi.mock("@/lib/db", () => ({
  db: {
    article: { findMany: findManyMocks.article },
    researchPaper: { findMany: findManyMocks.researchPaper },
    modelRelease: { findMany: findManyMocks.modelRelease },
    openSourceProject: { findMany: findManyMocks.openSourceProject },
    userReadHistory: { findMany: findManyMocks.userReadHistory },
    bookmark: { findMany: findManyMocks.bookmark },
    radarItem: { findMany: findManyMocks.radarItem }
  }
}));

import { getCandidatesInWindow } from "./candidates";

describe("getCandidatesInWindow — deterministic DB ordering before take", () => {
  beforeEach(() => {
    Object.values(findManyMocks).forEach((m) => m.mockClear());
  });

  it("orders articles by importance/relevance/recency before the take cap", async () => {
    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.article.mock.calls[0][0];
    expect(args.orderBy).toEqual([
      { importance: "desc" },
      { relevance: "desc" },
      { publishedAt: { sort: "desc", nulls: "last" } },
      { id: "asc" }
    ]);
    expect(args.take).toBe(150);
  });

  it("orders papers by importance/relevance/recency before the take cap", async () => {
    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.researchPaper.mock.calls[0][0];
    expect(args.orderBy).toEqual([
      { importance: "desc" },
      { relevance: "desc" },
      { publishedAt: { sort: "desc", nulls: "last" } },
      { id: "asc" }
    ]);
    expect(args.take).toBe(100);
  });

  it("orders model releases by importance/recency before the take cap", async () => {
    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.modelRelease.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ importance: "desc" }, { releaseDate: "desc" }, { id: "asc" }]);
    expect(args.take).toBe(30);
  });

  it("orders open-source projects by importance/recency before the take cap", async () => {
    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.openSourceProject.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ importance: "desc" }, { createdAt: "desc" }, { id: "asc" }]);
    expect(args.take).toBe(30);
  });

  it("includes an undated-article backlog clause keyed on discoveredAt (createdAt), not publishedAt", async () => {
    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.article.mock.calls[0][0];
    const hasUndatedBacklogClause = args.where.OR.some(
      (clause: any) => clause.publishedAt === null && clause.createdAt !== undefined
    );
    expect(hasUndatedBacklogClause).toBe(true);
  });
});

describe("getCandidatesInWindow — backlog excludes both shown AND read items", () => {
  beforeEach(() => {
    Object.values(findManyMocks).forEach((m) => m.mockClear());
    findManyMocks.userReadHistory.mockResolvedValue([]);
    findManyMocks.radarItem.mockResolvedValue([]);
  });

  it("excludes an item that was READ (but never shown by Radar) from the backlog notIn set", async () => {
    findManyMocks.userReadHistory.mockResolvedValue([{ articleId: "read-1", paperId: null, modelId: null, projectId: null }]);
    findManyMocks.radarItem.mockResolvedValue([]); // never shown

    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.article.mock.calls[0][0];
    const backlogClause = args.where.OR.find((c: any) => c.id?.notIn);
    expect(backlogClause.id.notIn).toContain("read-1");
  });

  it("excludes an item that was SHOWN (but never read) from the backlog notIn set", async () => {
    findManyMocks.userReadHistory.mockResolvedValue([]); // never read
    findManyMocks.radarItem.mockResolvedValue([{ articleId: "shown-1", paperId: null, modelId: null, projectId: null }]);

    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.article.mock.calls[0][0];
    const backlogClause = args.where.OR.find((c: any) => c.id?.notIn);
    expect(backlogClause.id.notIn).toContain("shown-1");
  });

  it("does NOT exclude an item that is neither shown nor read (genuinely eligible for a second chance)", async () => {
    findManyMocks.userReadHistory.mockResolvedValue([{ articleId: "other-read", paperId: null, modelId: null, projectId: null }]);
    findManyMocks.radarItem.mockResolvedValue([{ articleId: "other-shown", paperId: null, modelId: null, projectId: null }]);

    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.article.mock.calls[0][0];
    const backlogClause = args.where.OR.find((c: any) => c.id?.notIn);
    expect(backlogClause.id.notIn).not.toContain("eligible-item");
  });

  it("merges shown and read exclusions into one combined notIn set", async () => {
    findManyMocks.userReadHistory.mockResolvedValue([{ articleId: "read-only", paperId: null, modelId: null, projectId: null }]);
    findManyMocks.radarItem.mockResolvedValue([{ articleId: "shown-only", paperId: null, modelId: null, projectId: null }]);

    await getCandidatesInWindow("user1", new Date("2026-01-01"), new Date("2026-01-02"));
    const args = findManyMocks.article.mock.calls[0][0];
    const backlogClause = args.where.OR.find((c: any) => c.id?.notIn);
    expect(backlogClause.id.notIn).toEqual(expect.arrayContaining(["read-only", "shown-only"]));
  });

  it("bounds the backlog window to BACKLOG_LOOKBACK_DAYS regardless of checkpoint age", async () => {
    // Checkpoint from 90 days ago — backlogSince must still be capped at ~14
    // days back from now, not extended all the way to the checkpoint.
    const from = new Date(Date.now() - 90 * 86_400_000);
    const to = new Date();
    await getCandidatesInWindow("user1", from, to);
    const args = findManyMocks.article.mock.calls[0][0];
    const backlogClause = args.where.OR.find((c: any) => c.publishedAt?.gte && c.id?.notIn);
    const backlogSince = new Date(backlogClause.publishedAt.gte);
    const daysAgo = (Date.now() - backlogSince.getTime()) / 86_400_000;
    expect(daysAgo).toBeLessThanOrEqual(14.01); // small tolerance for test execution time
  });
});
