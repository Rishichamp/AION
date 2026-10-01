import { db } from "@/lib/db";

export type SourceHealthRow = {
  name: string;
  category: string | null;
  enabled: boolean;
  status: "fresh" | "stale" | "failed" | "never_run";
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
};

/** A source counts as "stale" if it hasn't had a successful run in this long
 *  — deliberately generous since research/news connectors are only
 *  scheduled every few hours (see README's suggested cron cadence). */
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export async function getSourceHealth(): Promise<SourceHealthRow[]> {
  const sources = await db.source.findMany();

  return Promise.all(
    sources.map(async (s: any) => {
      // Each fact queried independently — a source that failed its 5 most
      // recent runs (after a genuine success further back) must still show
      // that real last-success time, not have it hidden by a shared
      // most-recent-N window that happens not to include it.
      const [lastSuccess, lastAttempt, lastFailure] = await Promise.all([
        db.ingestionRun.findFirst({ where: { sourceId: s.id, status: "success" }, orderBy: { startedAt: "desc" } }),
        db.ingestionRun.findFirst({ where: { sourceId: s.id }, orderBy: { startedAt: "desc" } }),
        db.ingestionRun.findFirst({ where: { sourceId: s.id, status: "failed" }, orderBy: { startedAt: "desc" } })
      ]);

      let status: SourceHealthRow["status"] = "never_run";
      if (lastSuccess) {
        const isStale = Date.now() - new Date(lastSuccess.finishedAt ?? lastSuccess.startedAt).getTime() > STALE_THRESHOLD_MS;
        status = isStale ? "stale" : "fresh";
      } else if (lastAttempt?.status === "failed") {
        status = "failed";
      }

      return {
        name: s.name,
        category: s.category,
        enabled: s.enabled,
        status,
        lastSuccessAt: lastSuccess ? (lastSuccess.finishedAt ?? lastSuccess.startedAt) : null,
        lastAttemptAt: lastAttempt ? lastAttempt.startedAt : null,
        lastError: lastFailure?.error ?? null
      };
    })
  );
}

export type PublicFreshness = { status: "fresh" | "stale" | "insufficient_data"; lastSuccessAt: Date | null };

/** Public-safe version of source health for a user-facing badge — no
 *  source names or error text (that's operator-only, see /status), just
 *  the aggregate verdict and the most recent successful ingestion overall. */
export async function getPublicFreshness(): Promise<PublicFreshness> {
  const health = await getSourceHealth();
  const status = overallFreshnessFrom(health);
  const timestamps = health.map((h) => h.lastSuccessAt).filter((d): d is Date => d !== null);
  const lastSuccessAt = timestamps.length > 0 ? new Date(Math.max(...timestamps.map((d) => d.getTime()))) : null;
  return { status, lastSuccessAt };
}

/** Coarse verdict used by the Radar to distinguish a genuine quiet period
 *  from incomplete data — see the three-state distinction in generate.ts.
 *
 *  Computed from FRESH coverage specifically, not just a stale/failed ratio
 *  — a source that has literally never run is not "stale", it's missing
 *  entirely, and previously wasn't counted against freshness at all (10
 *  sources, 2 fresh + 8 never-run reported as "fresh" since 0 were
 *  stale/failed). Coverage-based: needs a healthy majority of enabled
 *  sources to have actually run successfully and recently. */
export async function getOverallFreshness(): Promise<"fresh" | "stale" | "insufficient_data"> {
  const health = await getSourceHealth();
  return overallFreshnessFrom(health);
}

function overallFreshnessFrom(health: SourceHealthRow[]): "fresh" | "stale" | "insufficient_data" {
  const enabled = health.filter((h) => h.enabled);
  if (enabled.length === 0) return "insufficient_data";

  const freshCount = enabled.filter((h) => h.status === "fresh").length;
  const neverRunCount = enabled.filter((h) => h.status === "never_run").length;
  const freshCoverage = freshCount / enabled.length;

  if (neverRunCount / enabled.length > 0.5) return "insufficient_data"; // most sources have literally never run
  if (freshCoverage < 0.5) return "stale"; // covers both stale and never-run dragging coverage down
  return "fresh";
}
