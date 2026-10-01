"use client";

import { useState } from "react";
import { RadarVisual } from "./RadarVisual";
import { ContentCard } from "./ContentCard";
import { Reveal } from "./Reveal";
import { SkeletonGrid } from "./Skeleton";

type RadarItem = {
  id: string;
  kind: "development" | "recommendation";
  reason: string | null;
  article?: { id: string; title: string; url: string; publishedAt: string | null } | null;
  paper?: { id: string; title: string; url: string; publishedAt: string | null } | null;
  model?: { id: string; name: string; organization: string; announcementUrl: string; releaseDate: string } | null;
  project?: { id: string; name: string; repoUrl: string; lastActivityAt: string | null } | null;
};

type Brief = { id: string; summary: string; checkpointFrom: string; checkpointTo: string; items: RadarItem[] };

/** Developments now come from any of the four content types the unified
 *  Radar candidate engine considers (see lib/radar/candidates.ts) — not just
 *  Articles. This normalizes whichever relation is populated into one shape
 *  the card can render. */
function normalize(item: RadarItem): { title: string; url: string; publishedAt: string | null; itemRef: any; eyebrow: string } | null {
  if (item.article) return { title: item.article.title, url: item.article.url, publishedAt: item.article.publishedAt, itemRef: { articleId: item.article.id }, eyebrow: "Article" };
  if (item.paper) return { title: item.paper.title, url: item.paper.url, publishedAt: item.paper.publishedAt, itemRef: { paperId: item.paper.id }, eyebrow: "Paper" };
  if (item.model) return { title: `${item.model.name} (${item.model.organization})`, url: item.model.announcementUrl, publishedAt: item.model.releaseDate, itemRef: { modelId: item.model.id }, eyebrow: "New Model Repo" };
  if (item.project) return { title: item.project.name, url: item.project.repoUrl, publishedAt: item.project.lastActivityAt, itemRef: { projectId: item.project.id }, eyebrow: "New on GitHub" };
  return null;
}

export function RadarRunner({ initialBrief }: { initialBrief: Brief | null }) {
  const [brief, setBrief] = useState<Brief | null>(initialBrief);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/radar");
      const data = await res.json();
      if (res.status === 202) {
        // Another request is already generating — don't overwrite the
        // current view with nothing; try again shortly.
        setTimeout(run, 2000);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "AION couldn't refresh right now. Your previous Radar is still available.");
        setScanning(false);
        return;
      }
      if (data.brief) setBrief(data.brief);
    } catch {
      setError("Something went wrong reaching AION. Your previous Radar is still available.");
    } finally {
      setScanning(false);
    }
  }

  // Records that the person has seen this item, so it won't resurface in a
  // future Radar run — independent of whether they also bookmark it.
  async function markRead(itemId: string) {
    await fetch("/api/radar", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId })
    });
  }

  const developments = brief?.items.filter((i) => i.kind === "development") ?? [];
  const recommendations = brief?.items.filter((i) => i.kind === "recommendation") ?? [];

  return (
    <div>
      <div className="hover-lift flex flex-col items-center gap-6 rounded-card border border-border bg-gradient-to-br from-surface to-surfaceHover p-8 text-center shadow-raised md:flex-row md:text-left">
        <div className="h-36 w-36 shrink-0 text-textFaint">
          <RadarVisual scanning={scanning} blips={developments.length || 3} />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-2xl text-text">What Changed Since Your Last Check?</h2>
          {brief && (
            <p className="mt-1 text-sm text-textMuted">
              Last checked {new Date(brief.checkpointFrom).toLocaleString()} · {developments.length} new
              development{developments.length === 1 ? "" : "s"} · {recommendations.length} recommended
            </p>
          )}
          <button
            onClick={run}
            disabled={scanning}
            className="mt-4 rounded-card bg-signal px-5 py-2.5 text-sm font-medium text-onAccent shadow-card transition-transform hover:scale-[1.03] hover:shadow-raised active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
          >
            {scanning ? "Scanning…" : "Run Radar"}
          </button>
          {error && <p className="mt-3 text-sm text-signal-text">{error}</p>}
        </div>
      </div>

      {scanning && !brief && (
        <div className="mt-8">
          <SkeletonGrid count={4} />
        </div>
      )}

      {brief && (
        <>
          <Reveal>
            <p className="mt-8 text-text">{brief.summary}</p>
          </Reveal>

          <section className="mt-8">
            <h3 className="font-display text-lg text-text">New Since Last Check</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {developments.length === 0 && <p className="text-sm text-textMuted">Nothing new yet.</p>}
              {developments.map((item, i) => {
                const content = normalize(item);
                if (!content) return null;
                return (
                  <Reveal key={item.id} delay={i * 70}>
                    <ContentCard
                      eyebrow={content.eyebrow}
                      title={content.title}
                      url={content.url}
                      publishedAt={content.publishedAt ?? undefined}
                      whyItMatters={item.reason ?? undefined}
                      onRead={() => markRead(item.id)}
                      itemRef={content.itemRef}
                    />
                  </Reveal>
                );
              })}
            </div>
          </section>

          <section className="mt-10">
            <h3 className="font-display text-lg text-text">Recommended Research</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {recommendations.length === 0 && <p className="text-sm text-textMuted">Nothing to recommend yet.</p>}
              {recommendations.map((item, i) => {
                const content = normalize(item);
                if (!content) return null;
                return (
                  <Reveal key={item.id} delay={i * 70}>
                    <ContentCard
                      eyebrow="Recommended"
                      title={content.title}
                      url={content.url}
                      publishedAt={content.publishedAt ?? undefined}
                      whyItMatters={item.reason ?? undefined}
                      onRead={() => markRead(item.id)}
                      itemRef={content.itemRef}
                    />
                  </Reveal>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
