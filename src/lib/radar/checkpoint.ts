import { db } from "@/lib/db";
import { randomUUID } from "crypto";

/** A user's very first checkpoint (no prior visit) looks back 7 days —
 *  configurable via this constant — so the first-ever Radar run has a
 *  genuinely useful onboarding window, not an arbitrary 3-day sliver. */
const FIRST_RUN_LOOKBACK_DAYS = 7;

export async function getCheckpoint(userId: string): Promise<{ from: Date; isFirstRun: boolean }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

  if (user.lastRadarGeneratedAt) {
    return { from: user.lastRadarGeneratedAt, isFirstRun: false };
  }

  const from = new Date();
  from.setDate(from.getDate() - FIRST_RUN_LOOKBACK_DAYS);
  return { from, isFirstRun: true };
}

export async function markCheckpoint(userId: string, at: Date = new Date(), client: Pick<typeof db, "user"> = db) {
  // Only the generation timestamp — lastRadarRequestAt is recorded
  // separately, at request initiation (see recordRadarRequest), not backdated
  // to the moment generation happens to succeed. These are different facts:
  // "a request was made" vs "generation completed successfully".
  await client.user.update({
    where: { id: userId },
    data: { lastRadarGeneratedAt: at }
  });
}

/** Records that a Radar request was INITIATED — called once per call to
 *  generateRadarBriefing, regardless of whether generation ultimately
 *  succeeds, fails, or hits the in-progress lock. Kept separate from
 *  markCheckpoint (which only fires on success) so lastRadarRequestAt and
 *  lastRadarGeneratedAt answer genuinely different questions. */
export async function recordRadarRequest(userId: string, at: Date = new Date()) {
  await db.user.update({ where: { id: userId }, data: { lastRadarRequestAt: at } }).catch(() => {});
}

const LOCK_STALE_MS = 60_000; // a lock older than this is treated as abandoned (crashed request), not active

/** Token-based DB-row mutex. Returns a unique ownership token if this call
 *  acquired the lock (safe to generate), or null if another request already
 *  holds it. See lib/radar/generate.ts — this exists so a phone and a
 *  laptop hitting "Run Radar" within the same second can't both advance the
 *  checkpoint and create inconsistent duplicate briefs.
 *
 *  The token matters for a subtler race a timestamp-only lock can't
 *  prevent: if request A takes longer than LOCK_STALE_MS, request B can
 *  correctly treat A's lock as abandoned and take over. But when A
 *  eventually finishes and calls releaseRadarLock(), a timestamp-only lock
 *  would clear B's now-current lock too — A has no way to tell "the lock
 *  that exists right now" from "MY lock". The token makes ownership
 *  explicit: release only succeeds if the caller's token still matches.
 *
 *  Atomic via updateMany's affected-row count (a plain read-then-write here
 *  would have the exact race this function exists to prevent). */
export async function acquireRadarLock(userId: string): Promise<string | null> {
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS);
  const token = randomUUID();
  const result = await db.user.updateMany({
    where: { id: userId, OR: [{ radarGeneratingSince: null }, { radarGeneratingSince: { lt: staleThreshold } }] },
    data: { radarGeneratingSince: new Date(), radarLockToken: token }
  });
  return result.count === 1 ? token : null;
}

/** Only clears the lock if `token` still matches what's currently stored —
 *  an old request whose lock was stale-takeover'd by a newer one will no
 *  longer match here, so it can't accidentally release the new owner's
 *  lock. */
export async function releaseRadarLock(userId: string, token: string) {
  await db.user
    .updateMany({ where: { id: userId, radarLockToken: token }, data: { radarGeneratingSince: null, radarLockToken: null } })
    .catch(() => {});
}
