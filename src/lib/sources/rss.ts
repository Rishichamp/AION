import Parser from "rss-parser";
import type { RawItem, SourceConnector } from "./types";

const parser = new Parser();

// Each configured feed becomes its own Source row (see prisma/seed.ts) so a
// single dead feed only disables itself, never the rest of the pipeline.
export const RSS_FEEDS: { name: string; url: string; category: "news" | "research" }[] = [
  { name: "OpenAI Blog", url: "https://openai.com/news/rss.xml", category: "news" },
  { name: "Google DeepMind Blog", url: "https://deepmind.google/blog/rss.xml", category: "news" },
  // Anthropic and Meta don't publish native RSS feeds (their sites have no
  // <link rel="alternate" type="application/rss+xml"> at all — confirmed
  // dead, not a URL typo). These point at Olshansk/rss-feeds, a community
  // project that scrapes both blogs and republishes valid RSS hourly.
  { name: "Anthropic News", url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml", category: "news" },
  { name: "Meta AI Blog", url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_meta_ai.xml", category: "news" },
  { name: "Microsoft Research Blog", url: "https://www.microsoft.com/en-us/research/feed/", category: "news" },
  { name: "NVIDIA AI Blog", url: "https://blogs.nvidia.com/blog/category/deep-learning/feed/", category: "news" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", category: "news" }
];

export function makeRssConnector(feed: { name: string; url: string; category: "news" | "research" }): SourceConnector {
  return {
    name: feed.name,
    category: feed.category,
    async fetch(sinceIso): Promise<RawItem[]> {
      try {
        const parsed = await parser.parseURL(feed.url);
        const since = sinceIso ? new Date(sinceIso) : null;

        return (parsed.items ?? [])
          .map((item) => ({
            kind: "article" as const,
            title: item.title ?? "Untitled",
            url: item.link ?? "",
            publishedAt: item.isoDate ? new Date(item.isoDate) : null, // unknown != now — see RawItem doc comment
            author: item.creator ?? item.author,
            description: item.contentSnippet ?? item.content
          }))
          .filter((it) => it.url && (!since || it.publishedAt === null || it.publishedAt > since));
      } catch (err) {
        console.error(`[rssConnector:${feed.name}] failed:`, err);
        return [];
      }
    }
  };
}
