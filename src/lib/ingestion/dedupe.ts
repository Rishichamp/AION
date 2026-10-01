/** Normalize a URL for comparison: strip tracking params, trailing slash, protocol. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    [...u.searchParams.keys()]
      .filter((k) => k.startsWith("utm_") || k === "ref" || k === "source")
      .forEach((k) => u.searchParams.delete(k));
    return `${u.hostname}${u.pathname}${u.search}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Cheap title similarity: normalized Jaccard on word sets. Good enough to catch
 *  the same paper/story mirrored across two sources with slightly different titles. */
export function titleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const setA = words(a);
  const setB = words(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

export const TITLE_SIMILARITY_THRESHOLD = 0.75;
