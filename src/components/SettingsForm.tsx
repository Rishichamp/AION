"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { enablePushNotifications } from "@/lib/push-client";

const TOPICS = [
  "LLMs", "SSMs", "Reasoning", "AI Agents", "Agentic AI", "Multimodal AI",
  "Generative AI", "Computer Vision", "RAG", "World Models", "Robotics",
  "AI Safety", "Alignment", "AI Infrastructure", "New AI Models", "Open Source AI"
];

type FocusData = { request: string; mutedKeywords: string[]; mutedSources: string[] };

type Props = {
  initialInterests: string[];
  initialNotifPrefs: { dailyBriefEnabled: boolean; dailyBriefTime: string; importantAlerts: boolean };
  initialFocus: FocusData;
};

export function SettingsForm({ initialInterests, initialNotifPrefs, initialFocus }: Props) {
  const { theme, setTheme } = useTheme();
  const [interests, setInterests] = useState(new Set(initialInterests));
  const [notifPrefs, setNotifPrefs] = useState(initialNotifPrefs);
  const [voiceInput, setVoiceInput] = useState(true);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [focusRequest, setFocusRequest] = useState(initialFocus.request);
  const [mutedKeywords, setMutedKeywords] = useState(initialFocus.mutedKeywords);
  const [mutedSources, setMutedSources] = useState(initialFocus.mutedSources);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  function toggleTopic(topic: string) {
    setInterests((prev) => {
      const next = new Set(prev);
      next.has(topic) ? next.delete(topic) : next.add(topic);
      return next;
    });
  }

  function addMutedKeyword() {
    const w = keywordDraft.trim().toLowerCase();
    if (w && !mutedKeywords.includes(w)) setMutedKeywords((prev) => [...prev, w]);
    setKeywordDraft("");
  }

  function removeMutedKeyword(w: string) {
    setMutedKeywords((prev) => prev.filter((x) => x !== w));
  }

  function toggleMutedSource(name: string) {
    setMutedSources((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  }

  async function save() {
    setSaved(false);
    setSaveError(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interests: [...interests].map((topic) => ({ topic, weight: 1 })),
          notifPrefs,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          focus: { request: focusRequest, mutedKeywords, mutedSources }
        })
      });
      if (!res.ok) throw new Error(`Settings save failed: ${res.status}`);
      localStorage.setItem("aion_voice_prefs", JSON.stringify({ voiceInput, voiceOutput }));
      setSaved(true);
    } catch (err) {
      console.error("[SettingsForm] save failed:", err);
      setSaveError(true);
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <h2 className="font-display text-lg text-text">What are you looking for?</h2>
        <p className="mt-1 text-sm text-textMuted">
          A standing request AION uses like a search query to bias ranking across Research, News, Models and Open
          Source — e.g. <span className="font-mono text-xs">agentic coding tools -crypto "small language models"</span>.
          Quote a phrase to match it exactly; prefix a word with <span className="font-mono text-xs">-</span> to
          exclude it entirely.
        </p>
        <textarea
          value={focusRequest}
          onChange={(e) => setFocusRequest(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder='e.g. reasoning models, agentic coding tools -crypto'
          className="mt-3 w-full rounded-card border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-textFaint focus:border-signal-text focus:outline-none"
        />

        <div className="mt-4">
          <span className="text-sm text-text">Always exclude these keywords</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {mutedKeywords.map((w) => (
              <button
                key={w}
                onClick={() => removeMutedKeyword(w)}
                title="Remove"
                className="rounded-full border border-borderStrong px-3 py-1 text-xs text-textMuted transition-theme hover:border-signal-text hover:text-signal-text"
              >
                {w} ×
              </button>
            ))}
            <input
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addMutedKeyword();
                }
              }}
              onBlur={addMutedKeyword}
              placeholder="add a word, press Enter"
              className="w-40 rounded-full border border-dashed border-borderStrong bg-transparent px-3 py-1 text-xs text-text placeholder:text-textFaint focus:border-signal-text focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4">
          <span className="text-sm text-text">Mute a source</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {["OpenAI Blog", "Google DeepMind Blog", "Anthropic News", "Meta AI Blog", "Microsoft Research Blog", "NVIDIA AI Blog", "Hugging Face Blog"].map(
              (name) => (
                <button
                  key={name}
                  onClick={() => toggleMutedSource(name)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-theme ${
                    mutedSources.includes(name)
                      ? "border-signal-text bg-signal-text/10 text-signal-text line-through"
                      : "border-borderStrong text-textMuted hover:border-signal/50 hover:text-text"
                  }`}
                >
                  {name}
                </button>
              )
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg text-text">Research interests</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {TOPICS.map((topic) => (
            <button
              key={topic}
              onClick={() => toggleTopic(topic)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-theme ${
                interests.has(topic)
                  ? "border-signal-text bg-signal-text/10 text-signal-text"
                  : "border-borderStrong text-textMuted hover:border-signal/50 hover:text-text"
              }`}
            >
              {topic}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg text-text">Notifications</h2>
        <div className="mt-3 space-y-3">
          <label className="hover-lift flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 shadow-card">
            <span className="text-sm text-text">Daily AI Radar notification</span>
            <input
              type="checkbox"
              checked={notifPrefs.dailyBriefEnabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                if (enabled) await enablePushNotifications();
                setNotifPrefs((p) => ({ ...p, dailyBriefEnabled: enabled }));
              }}
            />
          </label>
          <label className="hover-lift flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 shadow-card">
            <span className="text-sm text-text">Notification time</span>
            <input
              type="time"
              value={notifPrefs.dailyBriefTime}
              onChange={(e) => setNotifPrefs((p) => ({ ...p, dailyBriefTime: e.target.value }))}
              className="rounded bg-bg px-2 py-1 text-sm text-text"
            />
          </label>
          <label className="hover-lift flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 shadow-card">
            <span className="text-sm text-text">High-importance alerts</span>
            <input
              type="checkbox"
              checked={notifPrefs.importantAlerts}
              onChange={(e) => setNotifPrefs((p) => ({ ...p, importantAlerts: e.target.checked }))}
            />
          </label>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg text-text">Voice</h2>
        <div className="mt-3 space-y-3">
          <label className="hover-lift flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 shadow-card">
            <span className="text-sm text-text">Enable voice input</span>
            <input type="checkbox" checked={voiceInput} onChange={(e) => setVoiceInput(e.target.checked)} />
          </label>
          <label className="hover-lift flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 shadow-card">
            <span className="text-sm text-text">Enable voice output (read aloud)</span>
            <input type="checkbox" checked={voiceOutput} onChange={(e) => setVoiceOutput(e.target.checked)} />
          </label>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg text-text">Appearance</h2>
        <div className="mt-3 flex gap-2">
          {["dark", "light", "system"].map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`rounded-card border px-4 py-2 text-sm capitalize transition-theme ${
                theme === t
                  ? "border-signal-text bg-signal-text/10 text-signal-text"
                  : "border-borderStrong text-textMuted hover:border-signal/50 hover:text-text"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg text-text">Sources</h2>
        <p className="mt-1 text-sm text-textMuted">
          Enabling/disabling ingestion sources is an operator-level setting, not a per-user preference —
          see the read-only <a href="/status" className="text-signal-text hover:underline">Source Health</a> view.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} className="rounded-card bg-signal px-5 py-2.5 text-sm font-medium text-onAccent shadow-card transition-transform hover:scale-[1.02] hover:shadow-raised active:scale-[0.98]">
          Save settings
        </button>
        {saved && <span className="text-sm text-blip">Saved.</span>}
        {saveError && <span className="text-sm text-signal-text">Couldn't save — try again.</span>}
      </div>
    </div>
  );
}
