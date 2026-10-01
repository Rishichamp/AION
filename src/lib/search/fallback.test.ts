import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.SEARCH_PROVIDER = "brave";
process.env.SEARCH_API_KEY = "test-key";

const mocks = vi.hoisted(() => {
  let cacheStore: any = null;
  return {
    findUnique: vi.fn(() => Promise.resolve(cacheStore)),
    upsert: vi.fn((args: any) => {
      cacheStore = { queryHash: args.where.queryHash, ...args.create };
      return Promise.resolve(cacheStore);
    }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    reset: () => {
      cacheStore = null;
    }
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    searchCache: { findUnique: mocks.findUnique, upsert: mocks.upsert, deleteMany: mocks.deleteMany }
  }
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { targetedWebSearch } from "./fallback";

describe("targetedWebSearch — query-level cache prevents repeat provider calls", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.findUnique.mockClear();
    mocks.upsert.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web: { results: [{ title: "A paper", url: "https://example.com/a", description: "desc" }] } })
    });
  });

  it("calls the provider once for the first request, then serves the second identical query from cache", async () => {
    const first = await targetedWebSearch("SSM research", 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);

    const second = await targetedWebSearch("SSM research", 5);
    expect(fetchMock).toHaveBeenCalledTimes(1); // still 1 — served from cache, not re-fetched
    expect(second).toEqual(first);
  });

  it("is case/whitespace-insensitive for cache purposes (normalized query)", async () => {
    await targetedWebSearch("SSM Research", 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await targetedWebSearch("  ssm research  ", 5);
    expect(fetchMock).toHaveBeenCalledTimes(1); // same normalized query -> cache hit
  });
});
