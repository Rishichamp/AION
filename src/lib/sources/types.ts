export type RawItem = {
  kind: "article" | "paper" | "model" | "project";
  title: string;
  url: string;
  /** Null means "publication date genuinely unknown" — connectors must
   *  NEVER default this to `new Date()`. See lib/ingestion/pipeline.ts's
   *  validate() for how each content kind handles a null date (articles
   *  tolerate it; papers/models require a real one and are skipped
   *  otherwise, since those DB columns are non-nullable). */
  publishedAt: Date | null;
  author?: string;
  description?: string;
  // paper-specific
  authors?: string[];
  arxivId?: string;
  doi?: string;
  pdfUrl?: string;
  categories?: string[];
  // model-specific
  organization?: string;
  modelType?: string;
  capabilities?: string[];
  contextLength?: number;
  // project-specific
  stars?: number;
  lastActivityAt?: Date;
};

export type SourceConnector = {
  /** Matches the `name` column on the Source table. */
  name: string;
  category: "research" | "news" | "models" | "opensource";
  /** Fetch new items. Must never throw across the whole call — catch internally
   *  and return whatever was retrieved, so one broken source can't take down
   *  the rest of the ingestion run (see lib/ingestion/pipeline.ts). */
  fetch: (sinceIso?: string) => Promise<RawItem[]>;
};
