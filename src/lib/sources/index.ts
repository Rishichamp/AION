import type { SourceConnector } from "./types";
import { arxivConnector } from "./arxiv";
import { openAlexConnector } from "./openalex";
import { githubConnector } from "./github";
import { huggingFaceModelsConnector } from "./huggingface";
import { makeRssConnector, RSS_FEEDS } from "./rss";

export const ALL_CONNECTORS: SourceConnector[] = [
  arxivConnector,
  openAlexConnector,
  githubConnector,
  huggingFaceModelsConnector,
  ...RSS_FEEDS.map(makeRssConnector)
];

export function connectorsForCategory(category: SourceConnector["category"]) {
  return ALL_CONNECTORS.filter((c) => c.category === category);
}

export * from "./types";
