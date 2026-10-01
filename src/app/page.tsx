import Link from "next/link";
import { db } from "@/lib/db";
import { utcDayStart } from "@/lib/timezone";
import { getCurrentUser } from "@/lib/auth";
import { getReadNext } from "@/lib/radar/readNext";
import { getBookmarkedIds } from "@/lib/bookmarks";
import { RadarVisual } from "@/components/RadarVisual";
import { AskAion } from "@/components/AskAion";
import { ContentCard } from "@/components/ContentCard";
import { Reveal } from "@/components/Reveal";
import { FreshnessBadge } from "@/components/FreshnessBadge";
import { TrendingTopics } from "@/components/TrendingTopics";

export default async function HomePage() {
  const user = await getCurrentUser();
  const today = utcDayStart();

  const [dailyBriefRow, latestRadar, readNext, { paperIds }] = await Promise.all([
    db.dailyBrief.findUnique({ where: { date: today } }),
    db.radarBrief.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    getReadNext(user.id, 4),
    getBookmarkedIds(user.id)
  ]);

  const dailyBrief = dailyBriefRow ? (JSON.parse(dailyBriefRow.content) as { headline: string }) : null;

  return (
    <div className="relative overflow-hidden px-5 py-8 md:px-10 md:py-12">
      {/* Ambient background blobs — decorative only, purely CSS, no JS cost */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-signal/10 blob" aria-hidden />
      <div className="pointer-events-none absolute -right-16 top-40 h-64 w-64 rounded-full bg-blip/10 blob blob-delay" aria-hidden />

      <div className="relative grid gap-8 md:grid-cols-[1.2fr_0.8fr] md:items-center">
        <div>
          <Reveal>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-textMuted">Your personal AI research & intelligence radar</p>
              <FreshnessBadge />
            </div>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-2 font-display text-4xl leading-tight text-text md:text-5xl">
              What changed in AI<br />since you last checked?
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/radar"
                className="hover-lift rounded-card bg-signal px-5 py-3 text-sm font-medium text-onAccent shadow-card transition-transform hover:scale-[1.02] hover:shadow-raised active:scale-[0.98]"
              >
                What Changed Since I Last Checked?
              </Link>
            </div>
          </Reveal>
          <Reveal delay={220}>
            <div className="mt-6 max-w-xl">
              <AskAion />
            </div>
          </Reveal>
          <Reveal delay={280}>
            <div className="mt-5">
              <TrendingTopics />
            </div>
          </Reveal>
        </div>
        <Reveal delay={120} className="mx-auto h-56 w-56 text-textFaint md:h-64 md:w-64">
          <RadarVisual scanning={false} />
        </Reveal>
      </div>

      <Reveal delay={100}>
        <section className="relative mt-14">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-text">Today's AI Brief</h2>
            <Link href="/history" className="text-sm text-textMuted hover:text-text">
              Previous briefs
            </Link>
          </div>
          <div className="hover-lift mt-4 rounded-card border border-border bg-surface p-5 shadow-card">
            {dailyBrief ? (
              <p className="text-text">{dailyBrief.headline}</p>
            ) : (
              <p className="text-textMuted">
                No brief yet — the daily ingestion job hasn't run. See the README for scheduling it.
              </p>
            )}
          </div>
        </section>
      </Reveal>

      {latestRadar && (
        <Reveal delay={140}>
          <section className="relative mt-10">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-text">Since Your Last Check</h2>
              <Link href="/radar" className="text-sm text-textMuted hover:text-text">
                Open Radar
              </Link>
            </div>
            <div className="hover-lift mt-4 rounded-card border border-border bg-surface p-5 shadow-card">
              <p className="text-text">{latestRadar.summary}</p>
            </div>
          </section>
        </Reveal>
      )}

      {readNext.length > 0 && (
        <section className="relative mt-10">
          <Reveal>
            <h2 className="font-display text-xl text-text">What You Should Read Next</h2>
            <p className="mt-1 text-sm text-textMuted">
              Ranked by relevance to your interests — not just what's newest. See{" "}
              <Link href="/research" className="text-signal-text hover:underline">
                Research
              </Link>{" "}
              for the plain recency-sorted list.
            </p>
          </Reveal>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {readNext.map((p: any, i: number) => (
              <Reveal key={p.id} delay={i * 70}>
                <ContentCard
                  eyebrow="Read Next"
                  title={p.title}
                  publishedAt={p.publishedAt ?? undefined}
                  summary={p.aiSummary ?? p.abstract ?? undefined}
                  whyItMatters={p.keyContribution ?? undefined}
                  url={p.url}
                  itemRef={{ paperId: p.id }}
                  initialSaved={paperIds.has(p.id)}
                />
              </Reveal>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
