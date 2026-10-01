import { NextRequest, NextResponse } from "next/server";
import { assertCronAuthorized, CronAuthError } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { utcDayStart } from "@/lib/timezone";
import { completeJSON } from "@/lib/ai/client";
import { isAIQuotaError } from "@/lib/ai/errors";
import { buildFallbackBrief } from "@/lib/ai/fallbackBrief";
import { dailyBriefPrompt } from "@/lib/ai/prompts";

// Schedule: once per day.
export async function POST(req: NextRequest) {
  try {
    assertCronAuthorized(req);
  } catch (e) {
    if (e instanceof CronAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    throw e;
  }

  const since = new Date();
  since.setHours(since.getHours() - 24);

  const [articles, papers] = await Promise.all([
    db.article.findMany({ where: { publishedAt: { gte: since } }, orderBy: { importance: "desc" }, take: 30 }),
    db.researchPaper.findMany({ where: { publishedAt: { gte: since } }, orderBy: { importance: "desc" }, take: 15 })
  ]);

  const items = [
    ...articles.map((a: any) => ({ title: a.title, summary: a.aiSummary ?? "", category: a.category ?? "news" })),
    ...papers.map((p: any) => ({ title: p.title, summary: p.aiSummary ?? "", category: "research" }))
  ];

  const today = utcDayStart();

  if (items.length === 0) {
    await db.dailyBrief.upsert({
      where: { date: today },
      update: {},
      create: { date: today, content: JSON.stringify({ headline: "Quiet day.", sections: [] }) }
    });
    return NextResponse.json({ ok: true, items: 0 });
  }

  let ai: { headline: string; sections: { heading: string; points: string[] }[] };
  try {
    ai = await completeJSON<{ headline: string; sections: { heading: string; points: string[] }[] }>(
      dailyBriefPrompt(items)
    );
  } catch (err) {
    if (!isAIQuotaError(err)) throw err;
    console.warn("AI quota reached — writing a non-AI brief instead.");
    ai = buildFallbackBrief(items);
  }

  await db.dailyBrief.upsert({
    where: { date: today },
    update: { content: JSON.stringify(ai) },
    create: { date: today, content: JSON.stringify(ai) }
  });

  return NextResponse.json({ ok: true, items: items.length });
}
