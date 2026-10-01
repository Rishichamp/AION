import { NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({ secret: z.string().min(1) });

const COOKIE_NAME = "aion_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 4; // 4 hours — short-lived, dev/admin-only

// POST-body based login instead of a `?key=` URL param — a query string
// ends up in browser history, server access logs, and Referer headers; a
// POST body and the resulting httpOnly cookie do not. Still explicitly
// development/admin-only (see README) — this is not a general auth system.
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "secret required" }, { status: 400 });

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || parsed.data.secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  // Cookie value is the secret itself, scoped httpOnly+secure+sameSite=strict
  // — acceptable for a documented dev/admin-only mechanism; the important
  // property is that it never appears in a URL, browser history, or
  // server access logs the way `?key=` did.
  res.cookies.set(COOKIE_NAME, adminSecret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/"
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
