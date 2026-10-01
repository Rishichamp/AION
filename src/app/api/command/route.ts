import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseCommand } from "@/lib/commands/parser";
import { buildListResult, type CommandItem } from "@/lib/commands/format";
import { generateRadarBriefing, RadarInProgressError, RadarGenerationError } from "@/lib/radar/generate";
import { getReadNext } from "@/lib/radar/readNext";
import { getTopicBySlug } from "@/lib/topics/config";
import { targetedWebSearch, cacheWebResults } from "@/lib/search/fallback";
import { targetedArxivSearch, cacheResearchResults } from "@/lib/search/researchFallback";
import { utcDayStart } from "@/lib/timezone";
import { db } from "@/lib/db";

const MIN_DB_RESULTS_BEFORE_FALLBACK = 3;

// Single entry point for both typed and voice input (see lib/commands/parser.ts).
// Every intent below actually queries/ranks/returns real content — none of
// them just redirect the person to another page.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Empty command" }, { status: 400 });

  // The user's stored IANA timezone (see User.timezone, set from Settings)
  // is the primary model for calendar semantics — a raw browser UTC-offset
  // can't correctly resolve "midnight three days ago" across a DST
  // transition, and doesn't identify a specific calendar the way a real
  // IANA zone does. See lib/commands/temporal.ts.
  const parsed = await parseCommand(text, user.timezone);

  switch (parsed.intent) {
    case "since_last_check": {
      let brief;
      try {
        brief = await generateRadarBriefing(user.id);
      } catch (err) {
        if (err instanceof RadarInProgressError) {
          return NextResponse.json({ parsed, result: { type: "in_progress", headline: "", items: [], spokenText: "Still working on it — try again in a moment." } }, { status: 202 });
        }
        if (err instanceof RadarGenerationError) {
          console.error("[/api/command] radar generation failed:", err.message);
          return NextResponse.json(
            { parsed, result: { type: "error", headline: "", items: [], spokenText: "AION couldn't put together an update right now. Your previous Radar is still available." } },
            { status: 500 }
          );
        }
        throw err;
      }
      const items: CommandItem[] = (brief.items ?? []).map((it: any) => {
        const content = it.article ?? it.paper ?? it.model ?? it.project;
        const title = it.model ? `${it.model.name} (${it.model.organization})` : content?.title ?? content?.name;
        const url = content?.url ?? it.model?.announcementUrl ?? it.project?.repoUrl;
        const publishedAt = content?.publishedAt ?? it.model?.releaseDate ?? it.project?.lastActivityAt;
        return {
          title,
          url,
          whyItMatters: it.reason ?? undefined,
          publishedAt,
          itemRef: it.articleId
            ? { articleId: it.articleId }
            : it.paperId
              ? { paperId: it.paperId }
              : it.modelId
                ? { modelId: it.modelId }
                : it.projectId
                  ? { projectId: it.projectId }
                  : undefined
        };
      });
      return NextResponse.json({
        parsed,
        result: { type: "radar", headline: brief.summary, summary: brief.summary, items, spokenText: spokenRadar(brief.summary, items) }
      });
    }

    case "today": {
      const since = parsed.sinceDate ? new Date(parsed.sinceDate) : dayAgo();
      const until = parsed.untilDate ? new Date(parsed.untilDate) : undefined;
      const [articles, papers] = await Promise.all([
        db.article.findMany({ where: articleDateFilter(since, until), orderBy: [{ importance: "desc" }, { id: "asc" }], take: 5 }),
        db.researchPaper.findMany({ where: dateRange(since, until), orderBy: [{ importance: "desc" }, { id: "asc" }], take: 3 })
      ]);
      const items = toItems(articles, "article").concat(toItems(papers, "paper"));
      return NextResponse.json({ parsed, result: buildListResult("today", "Here's what happened in AI.", items, "Nothing notable logged in that window yet.") });
    }

    case "recent_research": {
      const since = parsed.sinceDate ? new Date(parsed.sinceDate) : dayAgo(7);
      const papers = await db.researchPaper.findMany({ where: { OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] }, orderBy: [{ importance: "desc" }, { publishedAt: "desc" }, { id: "asc" }], take: 6 });
      const items = toItems(papers, "paper");
      return NextResponse.json({ parsed, result: buildListResult("recent_research", "Recent research.", items, "No new papers ingested in that window.") });
    }

    case "topic_research": {
      const topic = parsed.topicSlug ? getTopicBySlug(parsed.topicSlug) : null;
      db.searchLog.create({ data: { userId: user.id, query: parsed.rawQuery } }).catch(() => {});
      if (!topic) {
        return NextResponse.json({ parsed, result: buildListResult("topic_research", "", [], "I couldn't identify that topic yet.") });
      }
      // The parser resolves temporal phrases ("this week", "yesterday") into
      // sinceDate/untilDate — this handler previously ignored them entirely,
      // so "SSM research this week" could return arbitrarily old papers.
      const since = parsed.sinceDate ? new Date(parsed.sinceDate) : undefined;
      const until = parsed.untilDate ? new Date(parsed.untilDate) : undefined;
      const paperWhere: any = { topics: { some: { slug: topic.slug } } };
      const articleWhere: any = { topics: { some: { slug: topic.slug } } };
      if (since) {
        Object.assign(paperWhere, dateRange(since, until));
        Object.assign(articleWhere, articleDateFilter(since, until));
      }
      const [papers, articles] = await Promise.all([
        db.researchPaper.findMany({ where: paperWhere, orderBy: [{ publishedAt: "desc" }, { id: "asc" }], take: 5 }),
        db.article.findMany({ where: articleWhere, orderBy: [{ publishedAt: "desc" }, { id: "asc" }], take: 3 })
      ]);
      let items = toItems(papers, "paper").concat(toItems(articles, "article"));

      // Database-first, but fall back to a TARGETED, research-aware search
      // when there just isn't enough in the DB yet — arXiv first (this is a
      // research query, not a general one), generic web search only if
      // arXiv itself doesn't have enough.
      if (items.length < MIN_DB_RESULTS_BEFORE_FALLBACK) {
        const arxivResults = await targetedArxivSearch(topic.name, 5);
        if (arxivResults.length > 0) {
          await cacheResearchResults(arxivResults);
          items = items.concat(arxivResults.map((r) => ({ title: r.title, url: r.url, whyItMatters: r.snippet, publishedAt: r.publishedAt ?? undefined })));
        }
        if (items.length < MIN_DB_RESULTS_BEFORE_FALLBACK) {
          const webResults = await targetedWebSearch(`${topic.name} AI research`, 5);
          if (webResults.length > 0) {
            await cacheWebResults(webResults);
            items = items.concat(webResults.map((r) => ({ title: r.title, url: r.url, whyItMatters: r.snippet })));
          }
        }
      }

      return NextResponse.json({
        parsed,
        result: buildListResult("topic_research", `What's new in ${topic.name}.`, items, `Nothing on ${topic.name} yet — check back once ingestion has run.`)
      });
    }

    case "recommendations": {
      const papers = await getReadNext(user.id, 5);
      const items = toItems(papers, "paper");
      return NextResponse.json({ parsed, result: buildListResult("recommendations", "Here's what's worth reading next.", items, "Nothing to recommend yet — ingestion needs to run first.") });
    }

    case "model_releases": {
      const since = parsed.sinceDate ? new Date(parsed.sinceDate) : dayAgo(30);
      const models = await db.modelRelease.findMany({ where: { releaseDate: { gte: since } }, orderBy: [{ releaseDate: "desc" }, { id: "asc" }], take: 6 });
      const items: CommandItem[] = models.map((m: any) => ({ title: `${m.name} (${m.organization})`, url: m.announcementUrl, whyItMatters: m.description ?? undefined, publishedAt: m.releaseDate, itemRef: { modelId: m.id } }));
      return NextResponse.json({ parsed, result: buildListResult("model_releases", "Recent model releases.", items, "No model releases tracked yet.") });
    }

    case "ai_news": {
      const since = parsed.sinceDate ? new Date(parsed.sinceDate) : dayAgo(7);
      const until = parsed.untilDate ? new Date(parsed.untilDate) : undefined;
      const articles = await db.article.findMany({ where: articleDateFilter(since, until), orderBy: [{ importance: "desc" }, { publishedAt: "desc" }, { id: "asc" }], take: 6 });
      const items = toItems(articles, "article");
      return NextResponse.json({ parsed, result: buildListResult("ai_news", "Top AI news.", items, "No news ingested yet.") });
    }

    case "open_source": {
      const since = parsed.sinceDate ? new Date(parsed.sinceDate) : dayAgo(14);
      const projects = await db.openSourceProject.findMany({ where: { lastActivityAt: { gte: since } }, orderBy: [{ importance: "desc" }, { lastActivityAt: "desc" }, { id: "asc" }], take: 6 });
      const items: CommandItem[] = projects.map((p: any) => ({ title: p.name, url: p.repoUrl, whyItMatters: p.whyItMatters ?? p.description ?? undefined, publishedAt: p.lastActivityAt ?? undefined, itemRef: { projectId: p.id } }));
      return NextResponse.json({ parsed, result: buildListResult("open_source", "Notable open-source AI activity.", items, "No open-source projects tracked yet.") });
    }

    case "daily_brief": {
      const today = utcDayStart();
      const brief = await db.dailyBrief.findUnique({ where: { date: today } });
      if (!brief) {
        return NextResponse.json({ parsed, result: buildListResult("daily_brief", "", [], "Today's brief hasn't been generated yet.") });
      }
      const parsedBrief = JSON.parse(brief.content) as { headline: string; sections: { heading: string; points: string[] }[] };
      const spoken = [parsedBrief.headline, ...parsedBrief.sections.flatMap((s) => s.points)].join(" ");
      return NextResponse.json({
        parsed,
        result: { type: "daily_brief", headline: parsedBrief.headline, items: [], spokenText: spoken.slice(0, 900) }
      });
    }

    case "search": {
      const query = parsed.rawQuery.replace(/^(search|find)( for)?/i, "").trim() || parsed.rawQuery;
      const contains = { contains: query, mode: "insensitive" as const };
      const [articles, papers] = await Promise.all([
        db.article.findMany({ where: { OR: [{ title: contains }, { description: contains }, { aiSummary: contains }] }, take: 5 }),
        db.researchPaper.findMany({
          where: { OR: [{ title: contains }, { abstract: contains }, { aiSummary: contains }, { keyContribution: contains }] },
          take: 5
        })
      ]);
      let items = toItems(articles, "article").concat(toItems(papers, "paper"));

      if (items.length < MIN_DB_RESULTS_BEFORE_FALLBACK) {
        const webResults = await targetedWebSearch(query, 5);
        if (webResults.length > 0) {
          await cacheWebResults(webResults);
          items = items.concat(webResults.map((r) => ({ title: r.title, url: r.url, whyItMatters: r.snippet })));
        }
      }

      return NextResponse.json({ parsed, result: buildListResult("search", `Results for "${query}".`, items, `Nothing found for "${query}".`) });
    }

    default:
      return NextResponse.json({ parsed, result: { type: "unknown", headline: "", items: [], spokenText: "I didn't quite catch that. Try asking what changed since your last check." } });
  }
}

function toItems(rows: any[], kind: "article" | "paper"): CommandItem[] {
  return rows.map((r) => ({
    title: r.title,
    url: r.url,
    whyItMatters: kind === "paper" ? r.keyContribution ?? r.aiSummary ?? undefined : r.keyPoint ?? r.aiSummary ?? undefined,
    publishedAt: r.publishedAt,
    itemRef: kind === "paper" ? { paperId: r.id } : { articleId: r.id }
  }));
}

function dayAgo(days = 1): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Article.publishedAt can be null (unknown — see schema.prisma comment);
 *  such rows still qualify for a date-windowed query via their discoveredAt
 *  (createdAt), never by pretending publishedAt was "now". */
function articleDateFilter(since: Date, until?: Date) {
  const publishedRange = until ? { gte: since, lt: until } : { gte: since };
  const createdRange = until ? { gte: since, lt: until } : { gte: since };
  return { OR: [{ publishedAt: publishedRange }, { publishedAt: null, createdAt: createdRange }] };
}

function dateRange(since: Date, until?: Date) {
  const range = until ? { gte: since, lt: until } : { gte: since };
  return { OR: [{ publishedAt: range }, { publishedAt: null, createdAt: range }] };
}

function spokenRadar(summary: string, items: CommandItem[]): string {
  const top = items.slice(0, 3).map((it, i) => `${i + 1}. ${it.title}.${it.whyItMatters ? ` ${it.whyItMatters}` : ""}`);
  return [summary, ...top].join(" ").slice(0, 900);
}
