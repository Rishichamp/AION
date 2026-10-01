import { NextRequest, NextResponse } from "next/server";
import { assertCronAuthorized, CronAuthError } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/push/webpush";
import { isDueForNotification } from "@/lib/push/schedule";
import { previewRadar } from "@/lib/radar/candidates";
import { getCheckpoint } from "@/lib/radar/checkpoint";

// Intended schedule: HOURLY (not once a day) — this checks every enabled
// user's *local* hour against their configured dailyBriefTime each run, and
// lastDailyNotificationAt prevents a duplicate send within the same local day.
//
// Deliberately read-only with respect to the Radar checkpoint: this route
// only counts what the real Radar ranking would actually show (previewRadar)
// — it must NEVER call generateRadarBriefing(), or a notification would silently advance the
// user's checkpoint before they ever opened the app, and they'd lose
// developments they never actually saw. See README's architecture notes.
export async function POST(req: NextRequest) {
  try {
    assertCronAuthorized(req);
  } catch (e) {
    if (e instanceof CronAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }

  const prefs = await db.notificationPreference.findMany({
    where: { dailyBriefEnabled: true },
    include: { user: true }
  });

  let sent = 0;
  let skipped = 0;
  let deliveryFailed = 0;

  for (const pref of prefs) {
    try {
      if (!isDueForNotification({ userId: pref.userId, timezone: pref.user.timezone, dailyBriefTime: pref.dailyBriefTime, lastDailyNotificationAt: pref.user.lastDailyNotificationAt }, new Date())) {
        skipped++;
        continue;
      }

      const { from } = await getCheckpoint(pref.userId);
      const { count } = await previewRadar(pref.userId, from, new Date());
      if (count === 0) continue; // don't spam with "nothing new"

      const result = await sendPushToUser(pref.userId, {
        title: "Your AION Radar is ready.",
        body: `${count} development${count === 1 ? "" : "s"} relevant to you since your last check.`,
        url: "/radar"
      });

      // Truthful: only mark as sent if delivery actually succeeded for at
      // least one subscription. If every subscription failed (or the user
      // has none left after stale ones were cleaned up), lastDailyNotificationAt
      // must NOT advance — otherwise a transient push-provider outage would
      // permanently skip that user for the rest of the day even though they
      // never actually got notified.
      if (result.delivered > 0) {
        await db.user.update({ where: { id: pref.userId }, data: { lastDailyNotificationAt: new Date() } });
        sent++;
      } else {
        deliveryFailed++;
      }
    } catch (err) {
      console.error(`[push/send] failed for user ${pref.userId}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, deliveryFailed });
}
