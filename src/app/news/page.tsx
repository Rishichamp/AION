import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBookmarkedIds } from "@/lib/bookmarks";
import { ContentCard } from "@/components/ContentCard";
import { FilterBar } from "@/components/FilterBar";
import { Reveal } from "@/components/Reveal";
import { SOURCE_QUALITY } from "@/lib/ingestion/classify";
import { getPersonalizationSignals, excludeClause } from "@/lib/personalize/feedback";
import { getUserFocus } from "@/lib/personalize/focus";
import { rankAndFilterList } from "@/lib/personalize/rankList";
import { getBehavioralTopicBoost, mergeInterestSignals } from "@/lib/radar/behavior";

const PAGE_SIZE = 30;
const POOL_SIZE = 120; // News has the highest volume of the four categories

// Short display labels for the filter pills — a source's Article rows all
// carry the full connector name (see lib/sources/rss.ts), which is right
// for attribution but too long for a pill. "OpenAI Blog" -> "OpenAI" etc.
// Falls back to the full name for any source not in this list, so a new
// connector never disappears from the filter bar.
const SHORT_LABEL: Record<string, string> = {
  "OpenAI Blog": "OpenAI",
  "Google DeepMind Blog": "DeepMind",
  "Anthropic News": "Anthropic (Claude)",
  "Meta AI Blog": "Meta",
  "Microsoft Research Blog": "Microsoft",
  "NVIDIA AI Blog": "NVIDIA",
  "Hugging Face Blog": "Hugging Face"
};

export default async function NewsPage({ searchParams }: { searchParams: { source?: string } }) {
  const user = await getCurrentUser();
  const [signals, focus, explicitInterests, behavioralBoost, { articleIds }, sourceCounts] = await Promise.all([
    getPersonalizationSignals(user.id),
    getUserFocus(user.id),
    db.userInterest.findMany({ where: { userId: user.id } }),
    getBehavioralTopicBoost(user.id),
    getBookmarkedIds(user.id),
    db.article.groupBy({ by: ["sourceId"], _count: { _all: true } })
  ]);

  const sources = await db.source.findMany({ where: { id: { in: sourceCounts.map((s: any) => s.sourceId as string) } } });
  const sourceById = new Map<string, string>(sources.map((s: any) => [s.id as string, s.name as string]));
  const countByName = new Map<string, number>();
  for (const s of sourceCounts as any[]) {
    const name = sourceById.get(s.sourceId);
    if (name) countByName.set(name, (countByName.get(name) ?? 0) + s._count._all);
  }

  const articles = await db.article.findMany({
    where: {
      id: { notIn: excludeClause(signals.hiddenIds.articleIds) },
      ...(searchParams.source ? { source: { name: searchParams.source } } : {})
    },
    orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
    take: POOL_SIZE,
    include: { topics: true, source: true }
  });

  const interestMap = mergeInterestSignals(
    new Map(explicitInterests.map((i: any): [string, number] => [i.topic, i.weight])),
    behavioralBoost
  );

  const ranked = rankAndFilterList(
    articles.map((a: any) => ({
      ...a,
      topicNames: a.topics.map((t: any) => t.name),
      topics: a.topics.map((t: any) => t.name),
      relevance: a.relevance,
      body: a.aiSummary ?? a.description ?? "",
      summary: a.aiSummary ?? a.description ?? "",
      people: a.author ?? "",
      discoveredAt: a.createdAt,
      sourceQuality: SOURCE_QUALITY[a.source?.name] ?? 0.5,
      sourceName: a.source?.name,
      bookmarked: articleIds.has(a.id)
    })),
    interestMap,
    signals,
    focus,
    PAGE_SIZE
  );

  const sourceOptions = [...countByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ value: name, label: SHORT_LABEL[name] ?? name, count }));

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">News</h1>
      <p className="mt-1 text-sm text-textMuted">Primary-source AI news, no clickbait.</p>

      <FilterBar param="source" options={sourceOptions} />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {ranked.length === 0 && (
          <p className="text-sm text-textMuted">
            {articles.length === 0 ? (
              <>No articles ingested yet — run <code className="font-mono">npm run ingest:news</code>.</>
            ) : (
              "Nothing matches your current filter and focus. Try clearing them in Settings or picking a different source."
            )}
          </p>
        )}
        {ranked.map((a: any, i: number) => (
          <Reveal key={a.id} delay={(i % 8) * 60}>
            <ContentCard
              eyebrow={a.category ?? a.topics[0] ?? "News"}
              title={a.title}
              meta={a.author ?? undefined}
              publishedAt={a.publishedAt ?? undefined}
              summary={a.aiSummary ?? a.description ?? undefined}
              whyItMatters={a.keyPoint ?? undefined}
              url={a.url}
              itemRef={{ articleId: a.id }}
              initialSaved={articleIds.has(a.id)}
              initialFeedback={signals.byKey.get(`article:${a.id}`)}
            />
          </Reveal>
        ))}
      </div>
    </div>
  );
}
