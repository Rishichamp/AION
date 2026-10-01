import { db } from "@/lib/db";

export { computeContentKey, type BookmarkItemRef } from "./bookmarks/contentKey";

export async function getBookmarkedIds(userId: string) {
  const bookmarks = await db.bookmark.findMany({
    where: { userId },
    select: { articleId: true, paperId: true, modelId: true, projectId: true }
  });

  return {
    articleIds: new Set(bookmarks.map((b: any) => b.articleId).filter(Boolean) as string[]),
    paperIds: new Set(bookmarks.map((b: any) => b.paperId).filter(Boolean) as string[]),
    modelIds: new Set(bookmarks.map((b: any) => b.modelId).filter(Boolean) as string[]),
    projectIds: new Set(bookmarks.map((b: any) => b.projectId).filter(Boolean) as string[])
  };
}
