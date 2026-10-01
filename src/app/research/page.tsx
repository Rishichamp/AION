import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBookmarkedIds } from "@/lib/bookmarks";
import { ContentCard } from "@/components/ContentCard";
import { FilterBar } from "@/components/FilterBar";
import { Reveal } from "@/components/Reveal";
import { TOPICS } from "@/lib/topics/config";
import { SOURCE_QUALITY } from "@/lib/ingestion/classify";
import { getPersonalizationSignals, excludeClause } from "@/lib/personalize/feedback";
import { getUserFocus } from "@/lib/personalize/focus";
import { rankAndFilterList } from "@/lib/personalize/rankList";
import { getBehavioralTopicBoost, mergeInterestSignals } from "@/lib/radar/behavior";

const PAGE_SIZE = 30;
// Fetched pre-filter/re-rank pool; must stay well above PAGE_SIZE so
// excluding not-interested items and re-ranking by focus has real material
// to work with, rather than just re-sorting whatever 30 the DB happened to
// return first.
const POOL_SIZE = 90;

export default async function ResearchPage({ searchParams }: { searchParams: { topic?: string } }) {
  const user = await getCurrentUser();
  const [signals, focus, explicitInterests, behavioralBoost, { paperIds }] = await Promise.all([
    getPersonalizationSignals(user.id),
    getUserFocus(user.id),
    db.userInterest.findMany({ where: { userId: user.id } }),
    getBehavioralTopicBoost(user.id),
    getBookmarkedIds(user.id)
  ]);

  const papers = await db.researchPaper.findMany({
    where: {
      id: { notIn: excludeClause(signals.hiddenIds.paperIds) },
      ...(searchParams.topic ? { topics: { some: { slug: searchParams.topic } } } : {})
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
    papers.map((p: any) => ({
      ...p,
      topicNames: p.topics.map((t: any) => t.name),
      topics: p.topics.map((t: any) => t.name),
      body: p.aiSummary ?? p.abstract ?? "",
      summary: p.aiSummary ?? p.abstract ?? "",
      people: p.authors.join(" "),
      discoveredAt: p.createdAt,
      sourceQuality: SOURCE_QUALITY[p.source?.name] ?? 0.5,
      sourceName: p.source?.name,
      bookmarked: paperIds.has(p.id)
    })),
    interestMap,
    signals,
    focus,
    PAGE_SIZE
  );

  const topicOptions = TOPICS.filter((t) => !t.ambiguous).map((t) => ({ value: t.slug, label: t.name }));

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">Research</h1>
      <p className="mt-1 text-sm text-textMuted">Ranked by importance, recency, relevance — and what you've told AION you're looking for.</p>

      <FilterBar param="topic" options={topicOptions} />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {ranked.length === 0 && (
          <p className="text-sm text-textMuted">
            {papers.length === 0 ? (
              <>No papers ingested yet — run <code className="font-mono">npm run ingest:research</code>.</>
            ) : (
              "Nothing matches your current filter and focus. Try clearing them in Settings or picking a different topic."
            )}
          </p>
        )}
        {ranked.map((p: any, i: number) => (
          <Reveal key={p.id} delay={(i % 8) * 60}>
            <ContentCard
              eyebrow={p.topics.slice(0, 2).join(" · ") || "Research"}
              title={p.title}
              meta={p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : "")}
              publishedAt={p.publishedAt ?? undefined}
              summary={p.aiSummary ?? p.abstract ?? undefined}
              whyItMatters={p.keyContribution ?? undefined}
              url={p.url}
              itemRef={{ paperId: p.id }}
              initialSaved={paperIds.has(p.id)}
              initialFeedback={signals.byKey.get(`paper:${p.id}`)}
            />
          </Reveal>
        ))}
      </div>
    </div>
  );
}
