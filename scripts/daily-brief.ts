import { PrismaClient } from "@prisma/client";
import { completeJSON } from "../src/lib/ai/client";
import { isAIQuotaError } from "../src/lib/ai/errors";
import { buildFallbackBrief } from "../src/lib/ai/fallbackBrief";
import { dailyBriefPrompt } from "../src/lib/ai/prompts";
import { utcDayStart } from "../src/lib/timezone";

const db = new PrismaClient();

async function main() {
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
    console.log("No new items in the last 24h — wrote a quiet-day brief.");
    return;
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

  console.log(`Daily brief written from ${items.length} items: "${ai.headline}"`);
}

main()
  .catch((err) => {
    console.error("Daily brief generation crashed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
