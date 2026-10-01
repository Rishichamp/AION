import { NextRequest, NextResponse } from "next/server";
import { assertCronAuthorized, CronAuthError } from "@/lib/cron-auth";
import { runIngestion } from "@/lib/ingestion/pipeline";
import { connectorsForCategory } from "@/lib/sources";

// Schedule: daily. Runs the real Hugging Face model-release connector (see
// lib/sources/huggingface.ts) — this used to be a placeholder that only
// noted model releases were derived from news ingestion; it now has its own
// dedicated source.
export async function POST(req: NextRequest) {
  try {
    assertCronAuthorized(req);
  } catch (e) {
    if (e instanceof CronAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }
  const results = await runIngestion(connectorsForCategory("models"));
  return NextResponse.json({ results });
}
