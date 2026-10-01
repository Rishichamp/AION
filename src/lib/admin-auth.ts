/**
 * Gate for operator-level endpoints that affect ALL users (toggling a
 * shared ingestion source) or expose internal operational detail (source
 * health/error messages) — these are application-wide, not per-user
 * preferences, and were previously reachable by any visitor.
 *
 * Checks `Authorization: Bearer $ADMIN_SECRET` (for API/script/cron-style
 * access) or the httpOnly session cookie set by POST /api/admin/login (for
 * the /status page). Deliberately does NOT accept the secret via a URL
 * query param — that ends up in browser history, server access logs, and
 * Referer headers, none of which a cookie or header does. If ADMIN_SECRET
 * isn't configured, access is denied by default — an unset secret must
 * never mean "open to everyone". This is a development/admin-only
 * mechanism, not a general auth system — see README.
 */
export function isAdminAuthorized(opts: { bearer?: string | null; cookie?: string | null }): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  if (opts.bearer === `Bearer ${secret}`) return true;
  if (opts.cookie === secret) return true;
  return false;
}
