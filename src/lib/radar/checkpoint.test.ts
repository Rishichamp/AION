import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  let row: { radarGeneratingSince: Date | null; radarLockToken: string | null } = {
    radarGeneratingSince: null,
    radarLockToken: null
  };
  return {
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn((args: any) => {
      const w = args.where;
      const matchesLockCondition = w.OR
        ? w.OR.some((c: any) =>
            "radarGeneratingSince" in c && c.radarGeneratingSince === null
              ? row.radarGeneratingSince === null
              : row.radarGeneratingSince !== null && row.radarGeneratingSince < c.radarGeneratingSince.lt
          )
        : row.radarLockToken === w.radarLockToken;
      if (!matchesLockCondition) return Promise.resolve({ count: 0 });
      row = { ...row, ...args.data };
      return Promise.resolve({ count: 1 });
    }),
    getRow: () => row,
    setRow: (r: typeof row) => {
      row = r;
    }
  };
});

vi.mock("@/lib/db", () => ({ db: { user: { update: mocks.update, updateMany: mocks.updateMany } } }));

import { markCheckpoint, recordRadarRequest, acquireRadarLock, releaseRadarLock } from "./checkpoint";

describe("markCheckpoint vs recordRadarRequest — semantically separate timestamps", () => {
  it("markCheckpoint only updates lastRadarGeneratedAt, never lastRadarRequestAt", async () => {
    mocks.update.mockClear();
    const at = new Date("2026-01-01T00:00:00Z");
    await markCheckpoint("user1", at);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "user1" }, data: { lastRadarGeneratedAt: at } });
  });

  it("recordRadarRequest only updates lastRadarRequestAt, never lastRadarGeneratedAt", async () => {
    mocks.update.mockClear();
    const at = new Date("2026-01-01T00:00:00Z");
    await recordRadarRequest("user1", at);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "user1" }, data: { lastRadarRequestAt: at } });
  });
});

describe("acquireRadarLock / releaseRadarLock — against the real implementation", () => {
  beforeEach(() => {
    mocks.setRow({ radarGeneratingSince: null, radarLockToken: null });
  });

  it("acquires successfully when free, returning a token", async () => {
    const token = await acquireRadarLock("user1");
    expect(token).not.toBeNull();
    expect(mocks.getRow().radarLockToken).toBe(token);
  });

  it("fails to acquire while a fresh lock is held", async () => {
    await acquireRadarLock("user1");
    const second = await acquireRadarLock("user1");
    expect(second).toBeNull();
  });

  it("releaseRadarLock only clears the lock when the token matches the current holder", async () => {
    const token = await acquireRadarLock("user1");
    await releaseRadarLock("user1", "wrong-token");
    expect(mocks.getRow().radarLockToken).toBe(token); // untouched

    await releaseRadarLock("user1", token!);
    expect(mocks.getRow().radarLockToken).toBeNull(); // now actually released
  });

  it("stale takeover: an old token can no longer release after a newer one has taken over", async () => {
    const tokenA = await acquireRadarLock("user1");
    // Simulate 61s passing without A releasing.
    mocks.setRow({ radarGeneratingSince: new Date(Date.now() - 61_000), radarLockToken: tokenA });

    const tokenB = await acquireRadarLock("user1");
    expect(tokenB).not.toBeNull();
    expect(tokenB).not.toBe(tokenA);

    // A finally releases with its own (now-stale) token.
    await releaseRadarLock("user1", tokenA!);

    // B's lock must survive.
    expect(mocks.getRow().radarLockToken).toBe(tokenB);
  });
});
