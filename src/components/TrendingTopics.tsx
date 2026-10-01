import Link from "next/link";
import { db } from "@/lib/db";

const WINDOW_DAYS = 7;

export async function TrendingTopics() {
  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);

  const topics = await db.topic.findMany({
    select: {
      slug: true,
      name: true,
      _count: {
        select: {
          articles: { where: { OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] } },
          papers: { where: { OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] } }
        }
      }
    }
  });

  const ranked = topics
    .map((t: any) => ({ slug: t.slug, name: t.name, count: t._count.articles + t._count.papers }))
    .filter((t: any) => t.count > 0)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 6);

  if (ranked.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-textFaint">Trending this week</span>
      {ranked.map((t: any) => (
        <Link
          key={t.slug}
          href={`/topics/${t.slug}`}
          className="hover-lift rounded-full border border-border bg-surface px-3 py-1 text-xs text-textMuted hover:border-signal-text/40 hover:text-text"
        >
          {t.name} <span className="text-textFaint">· {t.count}</span>
        </Link>
      ))}
    </div>
  );
}
