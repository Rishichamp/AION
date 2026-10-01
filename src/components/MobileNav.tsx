"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, FlaskConical, Bookmark, Settings, Home } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Home", icon: Home, match: "/" },
  { href: "/radar", label: "Radar", icon: Radar, match: "/radar" },
  { href: "/research", label: "Research", icon: FlaskConical, match: "/research" },
  { href: "/saved", label: "Saved", icon: Bookmark, match: "/saved" },
  { href: "/settings", label: "Settings", icon: Settings, match: "/settings" }
];

export function MobileNav() {
  const pathname = usePathname() ?? "/";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-border bg-bg/95 px-2 py-2 backdrop-blur transition-theme md:hidden">
      {ITEMS.map(({ href, label, icon: Icon, match }) => {
        const active = match === "/" ? pathname === "/" : pathname.startsWith(match);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center gap-1 rounded-card px-3 py-1 transition-theme ${
              active ? "text-signal-text" : "text-textMuted"
            }`}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span className="text-[10px]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
