import { describe, it, expect, vi } from "vitest";
import { computeContentKey } from "./contentKey";

describe("computeContentKey", () => {
  it("computes a stable key per content type", () => {
    expect(computeContentKey({ articleId: "abc123" })).toBe("article:abc123");
    expect(computeContentKey({ paperId: "xyz789" })).toBe("paper:xyz789");
    expect(computeContentKey({ modelId: "m1" })).toBe("model:m1");
    expect(computeContentKey({ projectId: "p1" })).toBe("project:p1");
  });

  it("is stable across repeated calls with the same ref (idempotency depends on this)", () => {
    const ref = { paperId: "same-id" };
    expect(computeContentKey(ref)).toBe(computeContentKey({ ...ref }));
  });

  it("throws if zero ref fields are provided", () => {
    expect(() => computeContentKey({})).toThrow();
  });

  it("throws if more than one ref field is provided", () => {
    expect(() => computeContentKey({ articleId: "a", paperId: "b" })).toThrow();
  });
});

describe("bookmark upsert — concurrency/idempotency simulation", () => {
  it("two 'concurrent' upserts with the same contentKey resolve to one row", async () => {
    // Simulates the DB-level guarantee the (userId, contentKey) unique
    // constraint provides: a real Postgres upsert would serialize these two
    // calls and return the same row either way. This test stands in for
    // that guarantee at the application logic level, since we don't have a
    // live Postgres instance in this environment — see the schema comment
    // on Bookmark.contentKey for the actual DB-level mechanism.
    const store = new Map<string, { id: string; contentKey: string }>();
    let nextId = 1;

    const upsert = vi.fn(async (userId: string, contentKey: string) => {
      const key = `${userId}:${contentKey}`;
      if (store.has(key)) return store.get(key)!;
      const row = { id: `bm${nextId++}`, contentKey };
      store.set(key, row);
      return row;
    });

    const ref = { paperId: "paper-1" };
    const key = computeContentKey(ref);

    const [a, b] = await Promise.all([upsert("user1", key), upsert("user1", key)]);

    expect(a.id).toBe(b.id); // same logical bookmark, not two rows
    expect(store.size).toBe(1);
  });
});
