import type { SourceConnector } from "./types";

const TOPICS = ["llm", "machine-learning", "large-language-models", "ai-agents", "diffusion-model"];

export const githubConnector: SourceConnector = {
  name: "GitHub",
  category: "opensource",
  async fetch(sinceIso) {
    const since = sinceIso ? sinceIso.slice(0, 10) : daysAgo(7);
    const headers: Record<string, string> = { accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    // GitHub's search syntax ANDs space-joined "topic:" qualifiers — a single
    // query with all five topics requires a repo to carry every topic at
    // once, which basically never happens and silently returns zero results.
    // Query each topic on its own and merge, deduping by repo id.
    const byId = new Map<number, any>();

    for (const topic of TOPICS) {
      try {
        const q = `topic:${topic} pushed:>${since}`;
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=25`;

        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`GitHub API responded ${res.status} for topic:${topic}`);
        const data = await res.json();
        for (const repo of data.items ?? []) byId.set(repo.id, repo);
      } catch (err) {
        // One bad topic query shouldn't drop the others.
        console.error(`[githubConnector] topic "${topic}" failed:`, err);
      }
    }

    return [...byId.values()].map((repo: any) => ({
      kind: "project" as const,
      title: repo.full_name,
      url: repo.html_url,
      publishedAt: new Date(repo.pushed_at ?? repo.updated_at),
      organization: repo.owner?.login,
      description: repo.description ?? undefined,
      stars: repo.stargazers_count,
      lastActivityAt: new Date(repo.pushed_at ?? repo.updated_at)
    }));
  }
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
