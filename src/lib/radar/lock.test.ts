import { describe, it, expect } from "vitest";

// A minimal in-memory simulation of the (radarGeneratingSince, radarLockToken)
// row this logic operates on — lets us exercise the exact interleaving
// described in review without needing a live Postgres instance. The
// acquire/release semantics mirror lib/radar/checkpoint.ts exactly (atomic
// compare-and-swap via an affected-row check).
type LockRow = { radarGeneratingSince: Date | null; radarLockToken: string | null };

function makeStore(initial: LockRow) {
  let row = { ...initial };
  const STALE_MS = 60_000;

  return {
    acquire(now: Date, token: string): string | null {
      const isFree = row.radarGeneratingSince === null;
      const isStale = row.radarGeneratingSince !== null && now.getTime() - row.radarGeneratingSince.getTime() > STALE_MS;
      if (!isFree && !isStale) return null;
      row = { radarGeneratingSince: now, radarLockToken: token };
      return token;
    },
    release(token: string) {
      if (row.radarLockToken === token) {
        row = { radarGeneratingSince: null, radarLockToken: null };
      }
      // else: no-op — this is exactly the protection under test
    },
    snapshot: () => ({ ...row })
  };
}

describe("Radar lock — token ownership prevents an old, stale-takeover'd request from clearing a newer owner's lock", () => {
  it("reproduces: A acquires -> A runs long -> B stale-takeover's -> A finishes and releases -> B's lock survives", () => {
    const store = makeStore({ radarGeneratingSince: null, radarLockToken: null });

    // 10:00:00 — A acquires.
    const tokenA = store.acquire(new Date("2026-01-01T10:00:00Z"), "token-A");
    expect(tokenA).toBe("token-A");

    // 10:01:01 — 61s later, A is still "running". Its lock is now stale,
    // so B legitimately takes over.
    const tokenB = store.acquire(new Date("2026-01-01T10:01:01Z"), "token-B");
    expect(tokenB).toBe("token-B");
    expect(store.snapshot().radarLockToken).toBe("token-B");

    // 10:01:10 — A finally finishes its (overly long) work and releases
    // using ITS OWN token, unaware it was stale-takeover'd.
    store.release("token-A");

    // The critical assertion: B's lock must still be intact. A timestamp-only
    // lock (no token) would have cleared it here, letting a third request
    // (C) acquire concurrently with B — exactly the bug this fixes.
    const afterARelease = store.snapshot();
    expect(afterARelease.radarLockToken).toBe("token-B");
    expect(afterARelease.radarGeneratingSince).not.toBeNull();

    // Confirm a third request genuinely cannot acquire while B still holds it.
    const tokenC = store.acquire(new Date("2026-01-01T10:01:11Z"), "token-C");
    expect(tokenC).toBeNull();

    // B finishes and releases with its own token — now it's actually free.
    store.release("token-B");
    expect(store.snapshot().radarLockToken).toBeNull();
  });

  it("a request can never acquire while a fresh (non-stale) lock is held by someone else", () => {
    const store = makeStore({ radarGeneratingSince: null, radarLockToken: null });
    store.acquire(new Date("2026-01-01T10:00:00Z"), "token-A");
    const attempt = store.acquire(new Date("2026-01-01T10:00:30Z"), "token-B"); // only 30s later — not stale
    expect(attempt).toBeNull();
  });

  it("releasing with the wrong/old token is always a no-op, never affects the current holder", () => {
    const store = makeStore({ radarGeneratingSince: null, radarLockToken: null });
    store.acquire(new Date("2026-01-01T10:00:00Z"), "token-current");
    store.release("token-stale-and-wrong");
    expect(store.snapshot().radarLockToken).toBe("token-current");
  });
});
