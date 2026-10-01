import { db } from "@/lib/db";
import type { RawItem, SourceConnector } from "@/lib/sources/types";
import { canonicalUrl, titleSimilarity, TITLE_SIMILARITY_THRESHOLD } from "./dedupe";
import { enrichItem, shouldSkipLLM, heuristicClassify, llmEnabled, setLlmAllowance } from "./classify";
import { matchTopic } from "@/lib/topics/config";

type PipelineResult = { source: string; found: number; stored: number; skipped: number; error?: string };

/** Runs one category's connectors end-to-end. A broken connector fails only
 *  its own IngestionRun row — the loop continues to the next source. */
export async function runIngestion(connectors: SourceConnector[], sinceIso?: string): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];

  for (const connector of connectors) {
    const source = await getOrCreateSource(connector);
    if (!source.enabled) {
      results.push({ source: connector.name, found: 0, stored: 0, skipped: 0 });
      continue;
    }
    const run = await db.ingestionRun.create({ data: { sourceId: source.id } });

    let found = 0;
    let stored = 0;
    let skipped = 0;

    try {
      const items = await connector.fetch(sinceIso);
      found = items.length;

      // Keep each run bounded: newest N items per source (some feeds return
      // their entire archive — 1,000+ posts), and give the few LLM calls the
      // free tier allows to items that match a known topic first.
      const prepared = prepareItems(items);
      setLlmAllowance(LLM_PER_SOURCE(connectors.length));

      for (const raw of prepared) {
        const ok = validate(raw);
        if (!ok) {
          skipped++;
          continue;
        }
        try {
          const wasStored = await storeItem(raw, source.id, connector.name);
          if (wasStored) stored++;
          else skipped++;
        } catch (err: any) {
          // A single bad/duplicate row must never abort the whole source.
          // P2002 = unique-constraint race/duplicate: just a skip.
          skipped++;
          if (err?.code !== "P2002") {
            console.error(`[ingestion] ${connector.name}: skipped "${raw.title.slice(0, 60)}":`, String(err?.message ?? err).split("\n").pop());
          }
        }
      }

      await db.ingestionRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "success", itemsFound: found, itemsStored: stored }
      });
      results.push({ source: connector.name, found, stored, skipped });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ingestion] ${connector.name} failed:`, message);
      await db.ingestionRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "failed", itemsFound: found, itemsStored: stored, error: message }
      });
      results.push({ source: connector.name, found, stored, skipped, error: message });
    }
  }

  return results;
}

function validate(raw: RawItem): boolean {
  if (!raw.title?.trim() || !raw.url?.trim()) return false;
  if (raw.publishedAt && Number.isNaN(raw.publishedAt.getTime())) return false; // malformed, not just missing

  // ModelRelease.releaseDate is a non-nullable column — rather than
  // fabricate a date to satisfy it, a model item with a genuinely unknown
  // release date is skipped. ResearchPaper.publishedAt and Article.publishedAt
  // are both nullable now, so those proceed with publishedAt: null.
  if (raw.kind === "model" && !raw.publishedAt) return false;
  return true;
}

async function getOrCreateSource(connector: SourceConnector) {
  const kindMap: Record<string, string> = {
    arXiv: "ARXIV",
    OpenAlex: "OPENALEX",
    GitHub: "GITHUB",
    "Hugging Face Models": "HUGGINGFACE"
  };
  const kind = kindMap[connector.name] ?? "RSS_NEWS";

  return db.source.upsert({
    where: { name: connector.name },
    update: {},
    create: { name: connector.name, kind: kind as any, endpoint: connector.name, category: connector.category }
  });
}

/** Dedupe against existing rows, then classify/score/summarize and persist.
 *  Returns false if the item was a duplicate (and thus not newly stored). */
async function storeItem(raw: RawItem, sourceId: string, sourceName: string): Promise<boolean> {
  const url = canonicalUrl(raw.url);

  if (raw.kind === "paper") {
    if (await db.researchPaper.findUnique({ where: { url: raw.url }, select: { id: true } })) return false;
    const existing = await findDuplicatePaper(raw, url);
    if (existing) return false;

    const { summary, keyPoint, topics, importance, novelty, relevance } = await classify(raw.title, raw.description ?? "", sourceName);

    await db.researchPaper.create({
      data: {
        sourceId,
        title: raw.title,
        url: raw.url,
        pdfUrl: raw.pdfUrl,
        arxivId: raw.arxivId,
        doi: raw.doi,
        authors: raw.authors ?? [],
        abstract: raw.description,
        aiSummary: summary,
        keyContribution: keyPoint,
        categories: raw.categories ?? [],
        publishedAt: raw.publishedAt,
        importance,
        novelty,
        relevance,
        topics: { connectOrCreate: topics.map((t) => topicConnect(t)) }
      }
    });
    return true;
  }

  if (raw.kind === "project") {
    const existing = await db.openSourceProject.findUnique({ where: { repoUrl: raw.url } });
    if (existing) {
      // Keep activity/popularity fresh on repeat sight — previously this
      // branch skipped entirely, so lastActivityAt/stars froze at whatever
      // they were the first time AION saw the repo.
      await db.openSourceProject.update({
        where: { id: existing.id },
        data: { lastActivityAt: raw.lastActivityAt, stars: raw.stars, description: raw.description }
      });
      return false; // not a newly-stored row, so not counted as "stored" by the run's stats
    }

    await db.openSourceProject.create({
      data: {
        sourceId,
        name: raw.title,
        organization: raw.organization,
        repoUrl: raw.url,
        description: raw.description,
        stars: raw.stars,
        lastActivityAt: raw.lastActivityAt,
        importance: Math.min(1, (raw.stars ?? 0) / 5000)
      }
    });
    return true;
  }

  if (raw.kind === "model") {
    const existing = await db.modelRelease.findUnique({ where: { announcementUrl: raw.url } });
    if (existing) return false;

    await db.modelRelease.create({
      data: {
        sourceId,
        name: raw.title,
        organization: raw.organization ?? "Unknown",
        releaseDate: raw.publishedAt ?? new Date(),
        modelType: raw.modelType,
        capabilities: raw.capabilities ?? [],
        contextLength: raw.contextLength,
        announcementUrl: raw.url,
        description: raw.description,
        // No LLM call here — HF's public listing API gives no model-card
        // summary to actually summarize (never fabricate one from nothing).
        // Heuristic only: a small bump for organizations widely recognized
        // as major labs, since HF's API doesn't expose usage/quality signals
        // for a public listing endpoint.
        importance: heuristicModelImportance(raw.organization)
      }
    });
    return true;
  }

  // article — `url` is unique across ALL time, but findDuplicateArticle only
  // looks at the last 7 days, so older already-stored posts used to slip
  // through and crash the insert with a unique-constraint error. Check exact
  // URL first, before spending an LLM call on it.
  if (await db.article.findUnique({ where: { url: raw.url }, select: { id: true } })) return false;
  const existing = await findDuplicateArticle(raw, url);
  if (existing) return false;

  const { summary, keyPoint, topics, importance, relevance } = await classify(raw.title, raw.description ?? "", sourceName);

  await db.article.create({
    data: {
      sourceId,
      title: raw.title,
      url: raw.url,
      canonicalUrl: url,
      author: raw.author,
      publishedAt: raw.publishedAt,
      description: raw.description,
      aiSummary: summary,
      keyPoint,
      importance,
      relevance,
      topics: { connectOrCreate: topics.map((t) => topicConnect(t)) }
    }
  });
  return true;
}

async function findDuplicatePaper(raw: RawItem, canonical: string) {
  if (raw.arxivId) {
    const byArxiv = await db.researchPaper.findUnique({ where: { arxivId: raw.arxivId } });
    if (byArxiv) return byArxiv;
  }
  if (raw.doi) {
    const byDoi = await db.researchPaper.findUnique({ where: { doi: raw.doi } });
    if (byDoi) return byDoi;
  }
  const recent = await db.researchPaper.findMany({
    where: { publishedAt: { gte: daysAgo(14) } },
    select: { id: true, title: true, url: true }
  });
  return recent.find((p: any) => canonicalUrl(p.url) === canonical || titleSimilarity(p.title, raw.title) >= TITLE_SIMILARITY_THRESHOLD);
}

async function findDuplicateArticle(raw: RawItem, canonical: string) {
  const recent = await db.article.findMany({
    where: { publishedAt: { gte: daysAgo(7) } },
    select: { id: true, title: true, canonicalUrl: true }
  });
  return recent.find((a: any) => a.canonicalUrl === canonical || titleSimilarity(a.title, raw.title) >= TITLE_SIMILARITY_THRESHOLD);
}

function topicConnect(name: string) {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return { where: { slug }, create: { slug, name } };
}

const KNOWN_MAJOR_LABS = ["openai", "google", "deepmind", "meta-llama", "mistralai", "anthropic", "microsoft", "deepseek-ai", "qwen", "nvidia"];

function heuristicModelImportance(organization: string | undefined): number {
  const org = (organization ?? "").toLowerCase();
  const isMajorLab = KNOWN_MAJOR_LABS.some((lab) => org.includes(lab));
  return isMajorLab ? 0.65 : 0.4;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Single entry point for turning raw title/body into
 *  {summary, keyPoint, topics, importance, novelty, relevance} — applies the
 *  cheap pre-filter (shouldSkipLLM) first so thin/low-quality/off-topic
 *  items never reach the LLM at all. See README's AI cost-control notes. */
async function classify(title: string, body: string, sourceName: string) {
  if (shouldSkipLLM(title, body, sourceName) || !llmEnabled()) {
    return heuristicClassify(title, body, sourceName);
  }
  return enrichItem(title, body, sourceName);
}

// ---- free-tier controls (all overridable via env) ----
const MAX_ITEMS_PER_SOURCE = Number(process.env.INGEST_MAX_ITEMS_PER_SOURCE ?? 100);
// Total LLM calls per category run, split across that category's sources.
// Gemini free tier: small default. Other providers: unlimited.
const LLM_PER_RUN = Number(process.env.AI_INGEST_LLM_PER_RUN ?? (process.env.AI_PROVIDER === "gemini" ? 6 : Infinity));
const LLM_PER_SOURCE = (sourceCount: number) => Math.max(1, Math.ceil(LLM_PER_RUN / Math.max(1, sourceCount)));

function prepareItems(items: RawItem[]): RawItem[] {
  const time = (i: RawItem) => (i.publishedAt ? i.publishedAt.getTime() : 0);
  const newest = [...items].sort((a, b) => time(b) - time(a)).slice(0, MAX_ITEMS_PER_SOURCE);
  const signal = (i: RawItem) => (matchTopic(`${i.title} ${i.description ?? ""}`) ? 1 : 0);
  return newest.sort((a, b) => signal(b) - signal(a)); // stable: topic matches first, still newest-first within each group
}
