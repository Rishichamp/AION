"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type FilterOption = { value: string; label: string; count?: number };

type Props = {
  /** Query-string param this bar controls, e.g. "topic", "source", "type". */
  param: string;
  options: FilterOption[];
  allLabel?: string;
};

/** A row of filter pills backed by the URL (?param=value), so filters are
 *  shareable/bookmarkable and work with zero client state. Matches the pill
 *  styling already used for interest chips in Settings. */
export function FilterBar({ param, options, allLabel = "All" }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(param);

  function hrefFor(value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(param, value);
    else params.delete(param);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  if (options.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Pill href={hrefFor(null)} active={!active} label={allLabel} />
      {options.map((o) => (
        <Pill key={o.value} href={hrefFor(o.value)} active={active === o.value} label={o.label} count={o.count} />
      ))}
    </div>
  );
}

function Pill({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`rounded-full border px-3 py-1.5 text-sm transition-theme ${
        active
          ? "border-signal-text bg-signal-text/10 text-signal-text"
          : "border-borderStrong text-textMuted hover:border-signal/50 hover:text-text"
      }`}
    >
      {label}
      {count != null && <span className="ml-1.5 text-xs text-textFaint">{count}</span>}
    </Link>
  );
}
