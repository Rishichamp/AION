"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissedIosHint, setDismissedIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari has no beforeinstallprompt event at all — there is no
    // programmatic install API there. Rather than a button that silently
    // does nothing, show the actual manual steps.
    if (isIos() && !isStandalone()) setShowIosHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  if (showIosHint && !dismissedIosHint) {
    return (
      <div className="fixed bottom-20 right-4 z-30 flex max-w-xs items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-raised md:bottom-6">
        <Share size={18} className="mt-0.5 shrink-0 text-signal-text" />
        <div className="text-sm text-text">
          <p className="font-medium">Install AION</p>
          <p className="mt-1 text-textMuted">Tap Share, then "Add to Home Screen". iOS doesn't offer a one-tap install.</p>
        </div>
        <button onClick={() => setDismissedIosHint(true)} aria-label="Dismiss" className="shrink-0 text-textFaint hover:text-text">
          <X size={16} />
        </button>
      </div>
    );
  }

  if (!deferred) return null;

  return (
    <button
      onClick={async () => {
        deferred.prompt();
        await deferred.userChoice;
        setDeferred(null);
      }}
      className="hover-lift fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-card bg-signal px-4 py-2 text-sm font-medium text-onAccent shadow-raised md:bottom-6"
    >
      <Download size={16} />
      Install AION
    </button>
  );
}
