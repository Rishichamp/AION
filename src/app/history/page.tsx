import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  const briefs = await db.radarBrief.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { items: true }
  });

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">History</h1>
      <p className="mt-1 text-sm text-textMuted">Every past Radar briefing, in one place.</p>

      <div className="mt-6 space-y-3">
        {briefs.length === 0 && <p className="text-sm text-textMuted">No briefings yet — run the Radar once.</p>}
        {briefs.map((b: any) => {
          const developments = b.items.filter((i: any) => i.kind === "development").length;
          const recommendations = b.items.filter((i: any) => i.kind === "recommendation").length;
          return (
            <div key={b.id} className="hover-lift flex items-center justify-between rounded-card border border-border bg-surface px-5 py-4 shadow-card hover:border-borderStrong hover:shadow-raised">
              <div>
                <p className="font-display text-text">
                  {new Date(b.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}
                </p>
                <p className="mt-0.5 text-sm text-textMuted">
                  {developments} new development{developments === 1 ? "" : "s"} · {recommendations} recommended paper
                  {recommendations === 1 ? "" : "s"}
                </p>
              </div>
              <a href="/radar" className="text-sm text-signal-text hover:text-signal-soft hover:underline">
                Reopen
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
