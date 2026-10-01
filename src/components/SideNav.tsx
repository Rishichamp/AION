"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, FlaskConical, Newspaper, Cpu, GitBranch, Layers, Bookmark, History, Settings } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

const ITEMS = [
  { href: "/radar", label: "Radar", icon: Radar, match: "/radar" },
  { href: "/research", label: "Research", icon: FlaskConical, match: "/research" },
  { href: "/news", label: "News", icon: Newspaper, match: "/news" },
  { href: "/models", label: "Models", icon: Cpu, match: "/models" },
  { href: "/open-source", label: "Open Source", icon: GitBranch, match: "/open-source" },
  { href: "/topics/llms", label: "Topics", icon: Layers, match: "/topics" },
  { href: "/saved", label: "Saved", icon: Bookmark, match: "/saved" },
  { href: "/history", label: "History", icon: History, match: "/history" },
  { href: "/settings", label: "Settings", icon: Settings, match: "/settings" }
];

export function SideNav() {
  const pathname = usePathname() ?? "";

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border px-5 py-6 transition-theme md:flex">
      <Link href="/" className="mb-8 block">
        <span className="font-display text-2xl font-medium tracking-tight text-text">AION</span>
        <span className="mt-0.5 block text-xs text-textFaint">Intelligence & Observation Network</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        {ITEMS.map(({ href, label, icon: Icon, match }) => {
          const active = pathname.startsWith(match);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-card px-3 py-2 text-sm transition-theme ${
                active ? "bg-surfaceHover text-text" : "text-textMuted hover:bg-surfaceHover hover:text-text"
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-signal-text" />}
              <Icon size={17} strokeWidth={1.75} className={active ? "text-signal-text" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-textFaint">Appearance</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
