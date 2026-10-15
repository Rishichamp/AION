import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Every /api/cron/* route calls this first. Point your host's scheduler
 *  (Vercel Cron, GitHub Actions, a plain crontab + curl, etc.) at these
 *  routes with `Authorization: Bearer $CRON_SECRET`. */
export function assertCronAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !safeEqual(header ?? "", `Bearer ${secret}`)) {
    throw new CronAuthError();
  }
}

export class CronAuthError extends Error {
  constructor() {
    super("Unauthorized cron request");
  }
}
