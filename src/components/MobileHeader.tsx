import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-bg/90 px-5 py-3 backdrop-blur transition-theme md:hidden">
      <Link href="/">
        <span className="font-display text-lg font-medium tracking-tight text-text">AION</span>
      </Link>
      <ThemeToggle />
    </header>
  );
}
