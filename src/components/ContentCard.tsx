"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Bookmark, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { timeAgo } from "@/lib/format";
import { ExplainPanel } from "./ExplainPanel";

type ItemRef = { articleId?: string; paperId?: string; modelId?: string; projectId?: string };

type Props = {
  eyebrow?: string;
  title: string;
  meta?: string;
  publishedAt?: string | Date | null;
  summary?: string;
  whyItMatters?: string;
  url: string;
  /** Fired when the person actually opens the source — the real signal that
   *  they've seen it, distinct from bookmarking it (see itemRef/toggleSave). */
  onRead?: () => void;
  /** Identifies which content row this card represents, so the bookmark
   *  button can actually persist a save instead of just recording a read. */
  itemRef?: ItemRef;
  initialSaved?: boolean;
  /** "NOT_INTERESTED" | "MORE_LIKE_THIS" | undefined, from the caller's
   *  bulk feedback lookup (mirrors initialSaved's pattern for bookmarks). */
  initialFeedback?: "NOT_INTERESTED" | "MORE_LIKE_THIS";
};

const REASONS: { value: string; label: string }[] = [
  { value: "off_topic", label: "Not my topic" },
  { value: "seen_it", label: "Already seen it" },
  { value: "too_basic", label: "Too basic" },
  { value: "wrong_source", label: "Don't show this source" },
  { value: "other", label: "Other" }
];

export function ContentCard({
  eyebrow,
  title,
  meta,
  publishedAt,
  summary,
  whyItMatters,
  url,
  onRead,
  itemRef,
  initialSaved = false,
  initialFeedback
}: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Props["initialFeedback"]>(initialFeedback);
  const [pickingReason, setPickingReason] = useState(false);
  const [hidden, setHidden] = useState(false);
  const router = useRouter();

  async function toggleSave() {
    if (!itemRef || pending) return;
    const next = !saved;
    setSaved(next); // optimistic — feels instant, matches "premium" bar for a one-tap action
    setPending(true);
    try {
      const res = await fetch("/api/bookmarks", {
        method: next ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(itemRef)
      });
      if (!res.ok) throw new Error(`Bookmark ${next ? "save" : "remove"} failed: ${res.status}`);
      router.refresh(); // re-syncs server-rendered pages like /saved that list by bookmark state
    } catch (err) {
      console.error("[ContentCard] bookmark toggle failed:", err);
      setSaved(!next); // roll back — a rejected request must not leave the UI claiming success
    } finally {
      setPending(false);
    }
  }

  async function sendFeedback(kind: "NOT_INTERESTED" | "MORE_LIKE_THIS", reason?: string) {
    if (!itemRef) return;
    setPickingReason(false);
    const wasHidden = hidden;
    if (kind === "NOT_INTERESTED") setHidden(true); // optimistic — gone from the list immediately
    setFeedback(kind);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...itemRef, kind, reason })
      });
      if (!res.ok) throw new Error(`Feedback failed: ${res.status}`);
    } catch (err) {
      console.error("[ContentCard] feedback failed:", err);
      setHidden(wasHidden);
      setFeedback(initialFeedback);
    }
  }

  async function undoNotInterested() {
    if (!itemRef) return;
    setHidden(false);
    setFeedback(undefined);
    try {
      const res = await fetch("/api/feedback", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(itemRef)
      });
      if (!res.ok) throw new Error(`Undo failed: ${res.status}`);
    } catch (err) {
      console.error("[ContentCard] undo failed:", err);
      setHidden(true);
      setFeedback("NOT_INTERESTED");
    }
  }

  if (hidden) {
    return (
      <div className="flex items-center justify-between rounded-card border border-dashed border-border bg-surface/50 px-5 py-4 text-sm text-textMuted">
        <span>Won't show this again.</span>
        <button onClick={undoNotInterested} className="text-signal-text hover:underline">
          Undo
        </button>
      </div>
    );
  }

  return (
    <article className="hover-lift rounded-card border border-border bg-surface p-5 shadow-card hover:border-borderStrong hover:shadow-raised">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {eyebrow && <span className="text-xs text-blip">{eyebrow}</span>}
        {eyebrow && publishedAt && <span className="text-xs text-textFaint">·</span>}
        {publishedAt && <span className="text-xs text-textFaint">{timeAgo(publishedAt)}</span>}
      </div>
      <h3 className="font-display text-lg leading-snug text-text">{title}</h3>
      {meta && <p className="mt-1 font-mono text-xs text-textFaint">{meta}</p>}
      {summary && <p className="mt-3 text-sm leading-relaxed text-textMuted">{summary}</p>}
      {whyItMatters && (
        <p className="mt-3 text-sm leading-relaxed text-text">
          <span className="text-signal-text">Why it matters — </span>
          {whyItMatters}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onRead}
          className="flex items-center gap-1.5 text-sm text-signal-text hover:text-signal-soft hover:underline"
        >
          Read <ExternalLink size={13} />
        </a>
        {itemRef && (
          <button
            onClick={toggleSave}
            aria-pressed={saved}
            className={`flex items-center gap-1.5 text-sm transition-theme ${
              saved ? "text-signal-text" : "text-textMuted hover:text-text"
            }`}
          >
            <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
            {saved ? "Saved" : "Save"}
          </button>
        )}
        {itemRef && (
          <button
            onClick={() => sendFeedback("MORE_LIKE_THIS")}
            aria-pressed={feedback === "MORE_LIKE_THIS"}
            title="Show more like this"
            className={`flex items-center gap-1.5 text-sm transition-theme ${
              feedback === "MORE_LIKE_THIS" ? "text-signal-text" : "text-textMuted hover:text-text"
            }`}
          >
            <ThumbsUp size={14} fill={feedback === "MORE_LIKE_THIS" ? "currentColor" : "none"} />
            More like this
          </button>
        )}
        {itemRef && !pickingReason && (
          <button
            onClick={() => setPickingReason(true)}
            className="flex items-center gap-1.5 text-sm text-textMuted transition-theme hover:text-text"
          >
            <ThumbsDown size={14} />
            Not interested
          </button>
        )}
      </div>
      {pickingReason && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-1 text-xs text-textFaint">Why?</span>
          {REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => sendFeedback("NOT_INTERESTED", r.value)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-textMuted transition-theme hover:border-signal/50 hover:text-text"
            >
              {r.label}
            </button>
          ))}
          <button onClick={() => setPickingReason(false)} aria-label="Cancel" className="ml-1 text-textFaint hover:text-text">
            <X size={14} />
          </button>
        </div>
      )}
      {itemRef?.paperId && (
        <div className="mt-3 border-t border-border pt-3 transition-theme">
          <ExplainPanel paperId={itemRef.paperId} />
        </div>
      )}
    </article>
  );
}
