import { describe, it, expect } from "vitest";
import { isDueForNotification } from "./schedule";

const base = { userId: "u1", timezone: "Asia/Kolkata", dailyBriefTime: "08:00", lastDailyNotificationAt: null as Date | null };

describe("isDueForNotification", () => {
  it("is due when the local hour matches and no notification has been sent yet", () => {
    // 08:00 IST == 02:30 UTC
    const now = new Date("2026-06-17T02:30:00Z");
    expect(isDueForNotification(base, now)).toBe(true);
  });

  it("is not due when the local hour doesn't match", () => {
    const now = new Date("2026-06-17T10:00:00Z"); // 15:30 IST
    expect(isDueForNotification(base, now)).toBe(false);
  });

  it("same-day dedupe: is not due again if already notified earlier the same local day", () => {
    const earlierToday = new Date("2026-06-17T02:15:00Z"); // 07:45 IST, same local day
    const now = new Date("2026-06-17T02:30:00Z"); // 08:00 IST
    expect(isDueForNotification({ ...base, lastDailyNotificationAt: earlierToday }, now)).toBe(false);
  });

  it("is due again the next local day even at the same local hour", () => {
    const yesterday = new Date("2026-06-16T02:30:00Z"); // 08:00 IST the previous day
    const now = new Date("2026-06-17T02:30:00Z"); // 08:00 IST today
    expect(isDueForNotification({ ...base, lastDailyNotificationAt: yesterday }, now)).toBe(true);
  });
});
