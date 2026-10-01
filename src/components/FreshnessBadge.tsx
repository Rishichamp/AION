import { getPublicFreshness } from "@/lib/sources/health";
import { timeAgo } from "@/lib/format";

const LABEL: Record<string, string> = {
  fresh: "Live",
  stale: "Catching up",
  insufficient_data: "Warming up"
};

const DOT_CLASS: Record<string, string> = {
  fresh: "bg-blip",
  stale: "bg-signal-text",
  insufficient_data: "bg-textFaint"
};

export async function FreshnessBadge() {
  const { status, lastSuccessAt } = await getPublicFreshness();

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-textMuted shadow-card">
      <span className={`h-1.5 w-1.5 rounded-full pulse-dot ${DOT_CLASS[status]}`} />
      {LABEL[status]}
      {lastSuccessAt && <span className="text-textFaint">· updated {timeAgo(lastSuccessAt)}</span>}
    </div>
  );
}
