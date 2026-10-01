import { cookies } from "next/headers";
import { getSourceHealth } from "@/lib/sources/health";
import { timeAgo } from "@/lib/format";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { AdminLoginForm } from "@/components/AdminLoginForm";

const STATUS_STYLE: Record<string, string> = {
  fresh: "text-blip",
  stale: "text-signal-text",
  failed: "text-signal-text",
  never_run: "text-textFaint"
};

const STATUS_LABEL: Record<string, string> = {
  fresh: "Fresh",
  stale: "Stale",
  failed: "Failed",
  never_run: "Never run"
};

// Internal/developer view — not linked from primary navigation. Answers
// "why didn't AION show today's update from source X" without digging
// through logs. See README's source-health notes.
export default async function StatusPage() {
  const sessionCookie = cookies().get("aion_admin_session")?.value;
  if (!isAdminAuthorized({ cookie: sessionCookie })) {
    return (
      <div className="px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-display text-2xl text-text">Not authorized</h1>
        <p className="mt-2 text-sm text-textMuted">This is an operator view. Sign in with the admin secret.</p>
        <AdminLoginForm />
      </div>
    );
  }

  const health = await getSourceHealth();

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-display text-2xl text-text">Source Health</h1>
      <p className="mt-1 text-sm text-textMuted">
        Internal ingestion status — not part of the primary navigation. Distinguishes "nothing changed" from
        "AION hasn't ingested anything recently."
      </p>

      <div className="mt-6 overflow-hidden rounded-card border border-border shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-surfaceHover text-textMuted">
            <tr>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Last success</th>
              <th className="px-4 py-2 font-medium">Last error</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.name} className="border-t border-border bg-surface transition-theme">
                <td className="px-4 py-2 text-text">
                  {h.name} {!h.enabled && <span className="text-textFaint">(disabled)</span>}
                </td>
                <td className="px-4 py-2 text-textMuted">{h.category ?? "—"}</td>
                <td className={`px-4 py-2 font-medium ${STATUS_STYLE[h.status]}`}>{STATUS_LABEL[h.status]}</td>
                <td className="px-4 py-2 text-textMuted">{h.lastSuccessAt ? timeAgo(h.lastSuccessAt) : "—"}</td>
                <td className="max-w-xs truncate px-4 py-2 text-textFaint" title={h.lastError ?? undefined}>
                  {h.lastError ?? "—"}
                </td>
              </tr>
            ))}
            {health.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-textMuted">
                  No sources registered yet — run <code className="font-mono">npm run prisma:seed</code>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
