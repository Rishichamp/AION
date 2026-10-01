import { getLocalTime } from "@/lib/timezone";

export type NotificationCandidate = {
  userId: string;
  timezone: string;
  dailyBriefTime: string; // "HH:mm"
  lastDailyNotificationAt: Date | null;
};

/** True if this user's local hour matches their configured notification
 *  hour AND they haven't already been notified today (local calendar day).
 *  Pure function — no DB/network — so the hour-matching and same-day-dedupe
 *  logic can be tested directly instead of only indirectly through the
 *  route. */
export function isDueForNotification(pref: NotificationCandidate, now: Date = new Date()): boolean {
  const { hhmm, localDate } = getLocalTime(pref.timezone, now);
  const dueHour = pref.dailyBriefTime.slice(0, 2);
  const currentHour = hhmm.slice(0, 2);
  if (dueHour !== currentHour) return false;

  const alreadySentToday =
    pref.lastDailyNotificationAt && getLocalTime(pref.timezone, pref.lastDailyNotificationAt).localDate === localDate;
  return !alreadySentToday;
}
