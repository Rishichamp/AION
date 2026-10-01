"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";

type Explanation = {
  problem: string;
  motivation: string;
  method: string;
  contribution: string;
  results: string;
  limitations: string;
  whyItMatters: string;
  prerequisites: string;
};

const FIELDS: { key: keyof Explanation; label: string }[] = [
  { key: "problem", label: "Problem" },
  { key: "motivation", label: "Motivation" },
  { key: "method", label: "Method" },
  { key: "contribution", label: "Key contribution" },
  { key: "results", label: "Results" },
  { key: "limitations", label: "Limitations" },
  { key: "whyItMatters", label: "Why it matters" },
  { key: "prerequisites", label: "Helpful background" }
];

export function ExplainPanel({ paperId }: { paperId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (explanation || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/explain?paperId=${paperId}`);
      const data = await res.json();
      if (data.explanation) setExplanation(data.explanation);
      else setError("Couldn't generate an explanation right now.");
    } catch {
      setError("Couldn't generate an explanation right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-sm text-textMuted transition-theme hover:text-text"
      >
        <Sparkles size={14} />
        Explain with AION
      </button>

      {open && (
        <div className="mt-3 rounded-card border border-border bg-bg p-4 transition-theme">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-textMuted">
              <Loader2 size={14} className="animate-spin" /> Reading the paper…
            </p>
          )}
          {error && <p className="text-sm text-signal-text">{error}</p>}
          {explanation && (
            <dl className="space-y-3">
              {FIELDS.filter((f) => explanation[f.key]?.trim()).map((f) => (
                <div key={f.key}>
                  <dt className="text-xs font-medium text-signal-text">{f.label}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-text">{explanation[f.key]}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
