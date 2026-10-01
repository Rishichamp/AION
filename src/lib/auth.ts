import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

// AION ships with a single "demo" account by default so it runs locally with
// zero setup. The shape (a real User row, a session cookie holding its id) is
// exactly what you'd swap in NextAuth/Clerk/etc. behind later — every other
// part of the app just calls getCurrentUser() and never knows the difference.
//
// The session cookie IS signed (HMAC-SHA256 over the user id, using
// SESSION_SECRET) so a client can't simply set `aion_session=<any-user-id>`
// and impersonate another account. This is still explicitly a
// development/demo mechanism, not production-grade multi-user auth — see
// README's "do not deploy publicly as-is" warning. Signing at least closes
// the gap where SESSION_SECRET was documented as doing something it didn't.

const SESSION_COOKIE = "aion_session";

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.warn(
      "[auth] SESSION_SECRET is not set — falling back to an insecure default. Fine for local dev, never for a real deployment. See .env.example."
    );
    return "dev-only-insecure-fallback-secret";
  }
  return secret;
}

export function sign(userId: string): string {
  const sig = createHmac("sha256", getSessionSecret()).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

/** Verifies the signature and returns the userId if valid, or null if the
 *  cookie is missing, malformed, or doesn't match (tampered/forged). */
export function verify(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const [userId, sig] = cookieValue.split(".");
  if (!userId || !sig) return null;

  const expected = createHmac("sha256", getSessionSecret()).update(userId).digest("hex");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  return timingSafeEqual(sigBuf, expectedBuf) ? userId : null;
}

export async function getCurrentUser() {
  const jar = cookies();
  const userId = verify(jar.get(SESSION_COOKIE)?.value);

  if (userId) {
    const existing = await db.user.findUnique({ where: { id: userId } });
    if (existing) return existing;
  }

  // First visit (or an invalid/tampered/forged cookie): create or reuse the
  // demo user and stamp a freshly signed session cookie.
  const demo = await db.user.upsert({
    where: { email: "demo@aion.local" },
    update: { lastVisitAt: new Date() },
    create: {
      email: "demo@aion.local",
      isDemo: true,
      notifPrefs: { create: {} }
    }
  });

  try {
    jar.set(SESSION_COOKIE, sign(demo.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365
    });
  } catch {
    // Next.js only allows writing cookies from a Server Action, Route
    // Handler, or Middleware — not from a Server Component's render (e.g.
    // the homepage calling getCurrentUser() directly). Harmless here: the
    // upsert-by-email above already finds/returns the same demo user every
    // time regardless of whether the cookie gets set.
  }
  return demo;
}
