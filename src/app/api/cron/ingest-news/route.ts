import { NextRequest, NextResponse } from "next/server";
import { assertCronAuthorized, CronAuthError } from "@/lib/cron-auth";
import { runIngestion } from "@/lib/ingestion/pipeline";
import { connectorsForCategory } from "@/lib/sources";

// Schedule: every few hours. See README for platform-specific cron setup.
export async function POST(req: NextRequest) {
  try {
    assertCronAuthorized(req);
  } catch (e) {
    if (e instanceof CronAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }
  const results = await runIngestion(connectorsForCategory("news"));
  return NextResponse.json({ results });
}
