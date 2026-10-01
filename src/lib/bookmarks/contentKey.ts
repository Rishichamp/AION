export type BookmarkItemRef = { articleId?: string; paperId?: string; modelId?: string; projectId?: string };

/** Deterministic key for a bookmark's target content — "article:<id>" etc.
 *  Exactly one of the four ref fields must be set; throws otherwise so a
 *  malformed call fails loudly rather than silently computing a bogus key.
 *  See the contentKey doc comment on the Bookmark model for why this
 *  exists (a compound unique constraint across nullable FK columns doesn't
 *  actually enforce uniqueness in Postgres). */
export function computeContentKey(ref: BookmarkItemRef): string {
  const entries = Object.entries(ref).filter(([, v]) => v != null) as [string, string][];
  if (entries.length !== 1) {
    throw new Error(`computeContentKey expects exactly one ref field, got ${entries.length}`);
  }
  const [field, id] = entries[0];
  const kind = field.replace(/Id$/, ""); // "articleId" -> "article"
  return `${kind}:${id}`;
}
