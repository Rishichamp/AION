import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBookmarkedIds } from "@/lib/bookmarks";
import { ContentCard } from "@/components/ContentCard";
import { getPersonalizationSignals, excludeClause } from "@/lib/personalize/feedback";

export default async function TopicPage({ params }: { params: { slug: string } }) {
  const user = await getCurrentUser();
  const [signals, topic, bookmarked] = await Promise.all([
    getPersonalizationSignals(user.id),
    db.topic.findUnique({ where: { slug: params.slug } }),
    getBookmarkedIds(user.id)
  ]);

  if (!topic) {
    return (
      <div className="px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-display text-2xl text-text">Topic not found yet</h1>
        <p className="mt-2 text-sm text-textMuted">This topic will appear once related content has been ingested.</p>
      </div>
    );
  }

  // Fetched separately (rather than as nested `include` relations on the
  // Topic query above) so each content type can exclude this user's
  // "not interested" items — a relation `include` has no per-user filter.
  const [papers, articles, models, projects] = await Promise.all([
    db.researchPaper.findMany({
      where: { topics: { some: { slug: params.slug } }, id: { notIn: excludeClause(signals.hiddenIds.paperIds) } },
      orderBy: { publishedAt: "desc" },
      take: 10
    }),
    db.article.findMany({
      where: { topics: { some: { slug: params.slug } }, id: { notIn: excludeClause(signals.hiddenIds.articleIds) } },
      orderBy: { publishedAt: "desc" },
      take: 10
    }),
    db.modelRelease.findMany({
      where: { topics: { some: { slug: params.slug } }, id: { notIn: excludeClause(signals.hiddenIds.modelIds) } },
      orderBy: { releaseDate: "desc" },
      take: 10
    }),
    db.openSourceProject.findMany({
      where: { topics: { some: { slug: params.slug } }, id: { notIn: excludeClause(signals.hiddenIds.projectIds) } },
      orderBy: { lastActivityAt: "desc" },
      take: 10
    })
  ]);

  const groups = [
    {
      label: "Research",
      items: papers.map((p: any) => ({
        title: p.title,
        summary: p.aiSummary,
        url: p.url,
        publishedAt: p.publishedAt,
        itemRef: { paperId: p.id },
        saved: bookmarked.paperIds.has(p.id),
        feedback: signals.byKey.get(`paper:${p.id}`)
      }))
    },
    {
      label: "News",
      items: articles.map((a: any) => ({
        title: a.title,
        summary: a.aiSummary,
        url: a.url,
        publishedAt: a.publishedAt,
        itemRef: { articleId: a.id },
        saved: bookmarked.articleIds.has(a.id),
        feedback: signals.byKey.get(`article:${a.id}`)
      }))
    },
    {
      label: "Models",
      items: models.map((m: any) => ({
        title: m.name,
        summary: m.description,
        url: m.announcementUrl,
        publishedAt: m.releaseDate,
        itemRef: { modelId: m.id },
        saved: bookmarked.modelIds.has(m.id),
        feedback: signals.byKey.get(`model:${m.id}`)
      }))
    },
    {
      label: "Open Source",
      items: projects.map((p: any) => ({
        title: p.name,
        summary: p.description,
        url: p.repoUrl,
        publishedAt: p.lastActivityAt,
        itemRef: { projectId: p.id },
        saved: bookmarked.projectIds.has(p.id),
        feedback: signals.byKey.get(`project:${p.id}`)
      }))
    }
  ];

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">{topic.name}</h1>

      {groups.map((g) => (
        <section key={g.label} className="mt-8">
          <h2 className="font-display text-lg text-text">{g.label}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {g.items.length === 0 && <p className="text-sm text-textMuted">Nothing here yet.</p>}
            {g.items.map((it: any, i: number) => (
              <ContentCard
                key={i}
                title={it.title}
                summary={it.summary ?? undefined}
                publishedAt={it.publishedAt ?? undefined}
                url={it.url}
                itemRef={it.itemRef}
                initialSaved={it.saved}
                initialFeedback={it.feedback}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
