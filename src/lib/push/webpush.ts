import webpush from "web-push";
import { db } from "@/lib/db";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — run `npx web-push generate-vapid-keys`");
  }
  webpush.setVapidDetails(VAPID_SUBJECT ?? "mailto:you@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

export type PushDeliveryResult = { attempted: number; delivered: number; removed: number; failed: number };

/** Returns a structured, truthful delivery result instead of a fire-and-
 *  forget void — callers (specifically /api/push/send) must know whether
 *  anything was ACTUALLY delivered before marking the daily notification as
 *  sent. Previously this returned nothing, so the caller had no way to tell
 *  "sent successfully" from "every subscription failed silently". */
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }): Promise<PushDeliveryResult> {
  ensureConfigured();
  const subs = await db.pushSubscription.findMany({ where: { userId } });

  const result: PushDeliveryResult = { attempted: subs.length, delivered: 0, removed: 0, failed: 0 };

  await Promise.all(
    subs.map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
        result.delivered++;
      } catch (err: any) {
        // 410/404 means the browser unsubscribed — clean it up so we stop retrying it.
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          result.removed++;
        } else {
          console.error("[webpush] send failed:", err);
          result.failed++;
        }
      }
    })
  );

  return result;
}
