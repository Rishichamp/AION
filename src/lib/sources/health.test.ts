import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sourceFindMany: vi.fn(),
  runFindFirst: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    source: { findMany: mocks.sourceFindMany },
    ingestionRun: { findFirst: mocks.runFindFirst }
  }
}));

import { getSourceHealth } from "./health";

describe("getSourceHealth — finds latest success independent of recent failure streaks", () => {
  it("reports the real (older) last success even after several more-recent failures", async () => {
    mocks.sourceFindMany.mockResolvedValue([{ id: "src1", name: "arXiv", category: "research", enabled: true }]);

    const oldSuccess = { startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:05:00Z") };
    const recentFailure = { startedAt: new Date("2026-06-01T00:00:00Z"), status: "failed", error: "timeout" };

    mocks.runFindFirst.mockImplementation(({ where }: any) => {
      if (where.status === "success") return Promise.resolve(oldSuccess);
      if (where.status === "failed") return Promise.resolve(recentFailure);
      return Promise.resolve(recentFailure); // "latest attempt" (no status filter) — the most recent run overall
    });

    const health = await getSourceHealth();
    expect(health[0].lastSuccessAt).toEqual(oldSuccess.finishedAt);
    // Stale (not "failed") — a real success exists, it's just old, which is
    // a different, more accurate state than "never succeeded".
    expect(health[0].status).toBe("stale");
    expect(health[0].lastError).toBe("timeout");
  });

  it("reports 'failed' only when there is truly no successful run at all", async () => {
    mocks.sourceFindMany.mockResolvedValue([{ id: "src2", name: "GitHub", category: "opensource", enabled: true }]);
    const failure = { startedAt: new Date(), status: "failed", error: "rate limited" };

    mocks.runFindFirst.mockImplementation(({ where }: any) => {
      if (where.status === "success") return Promise.resolve(null);
      return Promise.resolve(failure);
    });

    const health = await getSourceHealth();
    expect(health[0].status).toBe("failed");
    expect(health[0].lastSuccessAt).toBeNull();
  });

  it("reports 'never_run' when there are no ingestion runs at all", async () => {
    mocks.sourceFindMany.mockResolvedValue([{ id: "src3", name: "New Source", category: "news", enabled: true }]);
    mocks.runFindFirst.mockResolvedValue(null);

    const health = await getSourceHealth();
    expect(health[0].status).toBe("never_run");
  });
});
