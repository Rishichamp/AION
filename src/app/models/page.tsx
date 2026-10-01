import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBookmarkedIds } from "@/lib/bookmarks";
import { ContentCard } from "@/components/ContentCard";
import { FilterBar } from "@/components/FilterBar";
import { Reveal } from "@/components/Reveal";
import { getPersonalizationSignals, excludeClause } from "@/lib/personalize/feedback";
import { getUserFocus } from "@/lib/personalize/focus";
import { rankAndFilterList } from "@/lib/personalize/rankList";

const PAGE_SIZE = 30;
const POOL_SIZE = 90;
const MAX_TYPE_PILLS = 10; // modelType comes straight from Hugging Face's pipeline tags — arbitrary and long-tailed, so cap to the most common

// Hugging Face's pipeline_tag values are compact machine names
// ("text-generation") — a light label pass for the pills, without
// maintaining a full translation table for every possible tag.
function humanize(tag: string): string {
  return tag.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ModelsPage({ searchParams }: { searchParams: { type?: string } }) {
  const user = await getCurrentUser();
  const [signals, focus, explicitInterests, { modelIds }, typeCounts] = await Promise.all([
    getPersonalizationSignals(user.id),
    getUserFocus(user.id),
    db.userInterest.findMany({ where: { userId: user.id } }),
    getBookmarkedIds(user.id),
    db.modelRelease.groupBy({ by: ["modelType"], _count: { _all: true }, where: { modelType: { not: null } } })
  ]);

  const models = await db.modelRelease.findMany({
    where: {
      id: { notIn: excludeClause(signals.hiddenIds.modelIds) },
      ...(searchParams.type ? { modelType: searchParams.type } : {})
    },
    orderBy: { releaseDate: "desc" },
    take: POOL_SIZE
  });

  // Models don't carry a Topic relation (see schema) and importance is
  // usually left at the connector default, so ranking here leans on
  // recency + your "more like this" organizations/keywords rather than the
  // topic-weighted score the other three pages use.
  const interestMap: Map<string, number> = new Map(explicitInterests.map((i: any): [string, number] => [i.topic, i.weight]));

  const ranked = rankAndFilterList(
    models.map((m: any) => ({
      ...m,
      topicNames: [] as string[],
      topics: [] as string[],
      title: `${m.name} (${m.organization})`,
      body: m.description ?? "",
      summary: m.description ?? "",
      people: m.organization ?? "",
      publishedAt: m.releaseDate,
      discoveredAt: m.createdAt,
      importance: m.importance ?? 0.6,
      relevance: 0.6,
      sourceQuality: 0.8,
      sourceName: m.organization,
      bookmarked: modelIds.has(m.id)
    })),
    interestMap,
    signals,
    focus,
    PAGE_SIZE
  );

  const typeOptions = typeCounts
    .filter((t: any) => t.modelType)
    .sort((a: any, b: any) => b._count._all - a._count._all)
    .slice(0, MAX_TYPE_PILLS)
    .map((t: any) => ({ value: t.modelType as string, label: humanize(t.modelType as string), count: t._count._all }));

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">Models</h1>
      <p className="mt-1 text-sm text-textMuted">Recently created Hugging Face model repositories — not confirmed release announcements.</p>

      <FilterBar param="type" options={typeOptions} />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {ranked.length === 0 && (
          <p className="text-sm text-textMuted">
            {models.length === 0 ? "No model releases tracked yet." : "Nothing matches your current filter and focus."}
          </p>
        )}
        {ranked.map((m: any, i: number) => (
          <Reveal key={m.id} delay={(i % 8) * 60}>
            <ContentCard
              eyebrow={m.organization}
              title={m.name}
              meta={[m.modelType, m.contextLength ? `${m.contextLength.toLocaleString()} ctx` : null].filter(Boolean).join(" · ")}
              publishedAt={m.releaseDate}
              summary={m.description ?? undefined}
              url={m.announcementUrl}
              itemRef={{ modelId: m.id }}
              initialSaved={modelIds.has(m.id)}
              initialFeedback={signals.byKey.get(`model:${m.id}`)}
            />
          </Reveal>
        ))}
      </div>
    </div>
  );
}
