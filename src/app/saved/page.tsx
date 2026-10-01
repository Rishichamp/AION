import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ContentCard } from "@/components/ContentCard";
import { getPersonalizationSignals } from "@/lib/personalize/feedback";
import { computeContentKey } from "@/lib/bookmarks/contentKey";

export default async function SavedPage() {
  const user = await getCurrentUser();
  // Deliberately NOT excluding "not interested" items here — a bookmark is
  // an explicit "I want this", so it still belongs in Saved even if the
  // person later thumbs-down the same content while browsing a feed. The
  // thumb state is still shown for context, just not used to hide it.
  const [signals, bookmarks] = await Promise.all([
    getPersonalizationSignals(user.id),
    db.bookmark.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { article: true, paper: true, model: true, project: true }
    })
  ]);

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">Saved</h1>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {bookmarks.length === 0 && <p className="text-sm text-textMuted">Nothing saved yet.</p>}
        {bookmarks.map((b: any) => {
          const item = b.article ?? b.paper ?? b.model ?? b.project;
          if (!item) return null;
          const title = "title" in item ? item.title : "name" in item ? item.name : "Untitled";
          const url = "url" in item ? item.url : "announcementUrl" in item ? item.announcementUrl : (item as any).repoUrl;
          const publishedAt = item.publishedAt ?? item.releaseDate ?? item.lastActivityAt ?? undefined;
          const itemRef = b.articleId
            ? { articleId: b.articleId }
            : b.paperId
              ? { paperId: b.paperId }
              : b.modelId
                ? { modelId: b.modelId }
                : { projectId: b.projectId };
          return (
            <ContentCard
              key={b.id}
              title={title}
              url={url}
              publishedAt={publishedAt}
              itemRef={itemRef}
              initialSaved={true}
              initialFeedback={signals.byKey.get(computeContentKey(itemRef))}
            />
          );
        })}
      </div>
    </div>
  );
}
