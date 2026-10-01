import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBookmarkedIds } from "@/lib/bookmarks";
import { ContentCard } from "@/components/ContentCard";
import { FilterBar } from "@/components/FilterBar";
import { Reveal } from "@/components/Reveal";
import { TOPICS } from "@/lib/topics/config";
import { getPersonalizationSignals, excludeClause } from "@/lib/personalize/feedback";
import { getUserFocus } from "@/lib/personalize/focus";
import { rankAndFilterList } from "@/lib/personalize/rankList";
import { getBehavioralTopicBoost, mergeInterestSignals } from "@/lib/radar/behavior";

const PAGE_SIZE = 30;
const POOL_SIZE = 90;

export default async function OpenSourcePage({ searchParams }: { searchParams: { topic?: string } }) {
  const user = await getCurrentUser();
  const [signals, focus, explicitInterests, behavioralBoost, { projectIds }] = await Promise.all([
    getPersonalizationSignals(user.id),
    getUserFocus(user.id),
    db.userInterest.findMany({ where: { userId: user.id } }),
    getBehavioralTopicBoost(user.id),
    getBookmarkedIds(user.id)
  ]);

  const projects = await db.openSourceProject.findMany({
    where: {
      id: { notIn: excludeClause(signals.hiddenIds.projectIds) },
      ...(searchParams.topic ? { topics: { some: { slug: searchParams.topic } } } : {})
    },
    orderBy: [{ importance: "desc" }, { lastActivityAt: "desc" }],
    take: POOL_SIZE,
    include: { topics: true }
  });

  const interestMap = mergeInterestSignals(
    new Map(explicitInterests.map((i: any): [string, number] => [i.topic, i.weight])),
    behavioralBoost
  );

  const ranked = rankAndFilterList(
    projects.map((p: any) => ({
      ...p,
      topicNames: p.topics.map((t: any) => t.name),
      topics: p.topics.map((t: any) => t.name),
      publishedAt: p.lastActivityAt,
      discoveredAt: p.createdAt,
      relevance: 0.5,
      sourceQuality: 0.6,
      sourceName: p.organization ?? undefined,
      body: p.description ?? p.whyItMatters ?? "",
      summary: p.description ?? "",
      people: p.organization ?? "",
      bookmarked: projectIds.has(p.id)
    })),
    interestMap,
    signals,
    focus,
    PAGE_SIZE
  );

  const topicOptions = TOPICS.filter((t) => !t.ambiguous).map((t) => ({ value: t.slug, label: t.name }));

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">Open Source</h1>
      <p className="mt-1 text-sm text-textMuted">Notable AI repos and recent activity.</p>

      <FilterBar param="topic" options={topicOptions} />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {ranked.length === 0 && (
          <p className="text-sm text-textMuted">
            {projects.length === 0 ? (
              <>No projects ingested yet — run <code className="font-mono">npm run ingest:opensource</code>.</>
            ) : (
              "Nothing matches your current filter and focus. Try clearing them in Settings or picking a different topic."
            )}
          </p>
        )}
        {ranked.map((p: any, i: number) => (
          <Reveal key={p.id} delay={(i % 8) * 60}>
            <ContentCard
              eyebrow={p.organization ?? undefined}
              title={p.name}
              meta={p.stars ? `${p.stars.toLocaleString()} stars` : undefined}
              publishedAt={p.lastActivityAt ?? undefined}
              summary={p.description ?? undefined}
              whyItMatters={p.whyItMatters ?? undefined}
              url={p.repoUrl}
              itemRef={{ projectId: p.id }}
              initialSaved={projectIds.has(p.id)}
              initialFeedback={signals.byKey.get(`project:${p.id}`)}
            />
          </Reveal>
        ))}
      </div>
    </div>
  );
}
