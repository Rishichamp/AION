"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Volume2, VolumeX, Square, Loader2 } from "lucide-react";
import { ContentCard } from "./ContentCard";

type CommandItem = {
  title: string;
  url: string;
  whyItMatters?: string;
  publishedAt?: string | null;
  itemRef?: { articleId?: string; paperId?: string; modelId?: string; projectId?: string };
};

type CommandResponse = {
  parsed: { intent: string };
  result: { type: string; headline: string; summary?: string; items: CommandItem[]; spokenText: string };
};

type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error";

const LANGUAGES = [
  { code: "auto", label: "Auto" },
  { code: "en-US", label: "English" },
  { code: "hi-IN", label: "Hindi" }
];

export function AskAion() {
  const [supportsSpeech, setSupportsSpeech] = useState(false);

  useEffect(() => {
    setSupportsSpeech(
      "SpeechRecognition" in window ||
        "webkitSpeechRecognition" in window
    );
  }, []);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [text, setText] = useState("");
  const [readAloud, setReadAloud] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [response, setResponse] = useState<CommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  function resolvedLang() {
    if (language !== "auto") return language;
    return typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
  }

  async function submit(utterance: string) {
    if (!utterance.trim() || voiceState === "processing") return;
    setVoiceState("processing");
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: utterance })
      });
      const data: CommandResponse = await res.json();
      setResponse(data);

      if (readAloud && "speechSynthesis" in window && data.result?.spokenText) {
        speak(data.result.spokenText);
      } else {
        setVoiceState("idle");
      }
    } catch {
      setError("Something went wrong reaching AION. Try again in a moment.");
      setVoiceState("error");
    }
  }

  function speak(spokenText: string) {
    // Never let recognition and synthesis run at once — stop any in-flight
    // recognition before AION starts talking.
    recognitionRef.current?.abort?.();
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(spokenText);
    utter.lang = resolvedLang();
    utter.onstart = () => setVoiceState("speaking");
    utter.onend = () => setVoiceState("idle");
    utter.onerror = () => setVoiceState("idle");
    window.speechSynthesis.speak(utter);
  }

  function stopSpeaking() {
    window.speechSynthesis.cancel();
    setVoiceState("idle");
  }

  function startListening() {
    if (voiceState === "speaking") window.speechSynthesis.cancel(); // don't fight with TTS
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupportsSpeech(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = resolvedLang();
    recognition.onstart = () => setVoiceState("listening");
    recognition.onerror = () => setVoiceState("idle");
    recognition.onend = () => setVoiceState((s) => (s === "listening" ? "idle" : s));
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setText(transcript);
      submit(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  const result = response?.result;

  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center gap-3">
        {supportsSpeech ? (
          <button
            onClick={startListening}
            disabled={voiceState === "processing"}
            aria-label="Ask AION with your voice"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
              voiceState === "listening" ? "border-blip bg-blip/20 text-blip" : "border-borderStrong text-textMuted hover:text-text"
            }`}
          >
            {voiceState === "processing" ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
          </button>
        ) : null}

        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={supportsSpeech ? 'Ask AION — "What changed since I last checked?"' : 'Voice isn\u2019t supported here — type your question'}
            className="flex-1 rounded-card border border-borderStrong bg-bg px-3 py-2 text-sm text-text placeholder:text-textFaint focus-visible:border-signal-text"
          />
          <button
            type="submit"
            aria-label="Send"
            className="flex h-9 w-9 items-center justify-center rounded-card bg-signal text-onAccent transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            disabled={voiceState === "processing"}
          >
            <Send size={15} />
          </button>
        </form>

        {voiceState === "speaking" ? (
          <button
            onClick={stopSpeaking}
            aria-label="Stop speaking"
            title="Stop speaking"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-signal-text text-signal-text transition-theme"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={() => setReadAloud((v) => !v)}
            aria-pressed={readAloud}
            aria-label="Toggle read aloud"
            title="Read Aloud"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border transition-theme ${
              readAloud ? "border-signal-text text-signal-text" : "border-borderStrong text-textMuted"
            }`}
          >
            {readAloud ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        )}
      </div>

      {supportsSpeech && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-xs text-textFaint">Voice language:</span>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => setLanguage(l.code)}
              className={`rounded-full px-2 py-0.5 text-xs transition-theme ${
                language === l.code ? "bg-signal-text/10 text-signal-text" : "text-textMuted hover:text-text"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {voiceState === "listening" && <p className="mt-3 text-xs text-blip">🎙 Listening…</p>}
      {voiceState === "processing" && <p className="mt-3 text-xs text-textMuted">Here it is…</p>}
      {voiceState === "speaking" && <p className="mt-3 text-xs text-signal-text">🔊 Speaking…</p>}
      {error && <p className="mt-3 text-sm text-signal-text">{error}</p>}

      {result && (
        <div className="mt-4">
          {result.headline && <p className="text-sm font-medium text-text">{result.headline}</p>}
          {result.summary && result.summary !== result.headline && (
            <p className="mt-1 text-sm leading-relaxed text-textMuted">{result.summary}</p>
          )}
          {result.items.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {result.items.map((it, i) => (
                <ContentCard
                  key={i}
                  title={it.title}
                  url={it.url}
                  whyItMatters={it.whyItMatters}
                  publishedAt={it.publishedAt}
                  itemRef={it.itemRef}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
