import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { sign, verify } from "./auth";

describe("session cookie signing", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret";
  });

  it("verify() accepts a value produced by sign()", () => {
    const cookieValue = sign("user-123");
    expect(verify(cookieValue)).toBe("user-123");
  });

  it("verify() rejects a forged cookie with an arbitrary userId and no valid signature", () => {
    expect(verify("someone-elses-id.not-a-real-signature")).toBeNull();
  });

  it("verify() rejects a tampered userId even with the original signature format intact", () => {
    const original = sign("user-123");
    const [, sig] = original.split(".");
    const tampered = `user-456.${sig}`; // swapped the id, kept the (now-invalid) signature
    expect(verify(tampered)).toBeNull();
  });

  it("verify() rejects a missing or malformed cookie value", () => {
    expect(verify(undefined)).toBeNull();
    expect(verify("")).toBeNull();
    expect(verify("no-dot-separator")).toBeNull();
  });

  it("a value signed with a different secret does not verify (secret rotation invalidates old sessions)", () => {
    const cookieValue = sign("user-123");
    process.env.SESSION_SECRET = "a-different-secret";
    expect(verify(cookieValue)).toBeNull();
  });
});
