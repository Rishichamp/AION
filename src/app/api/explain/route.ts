import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { completeJSON } from "@/lib/ai/client";
import { explainPaperPrompt } from "@/lib/ai/prompts";

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

// In-memory only (per server instance) — this is a P2 nice-to-have, not
// worth a schema migration yet. See README's known limitations.
const cache = new Map<string, Explanation>();

export async function GET(req: Request) {
  const paperId = new URL(req.url).searchParams.get("paperId");
  if (!paperId) return NextResponse.json({ error: "paperId required" }, { status: 400 });

  if (cache.has(paperId)) return NextResponse.json({ explanation: cache.get(paperId) });

  const paper = await db.researchPaper.findUnique({ where: { id: paperId } });
  if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

  try {
    const explanation = await completeJSON<Explanation>(
      explainPaperPrompt(paper.title, paper.abstract ?? paper.aiSummary ?? paper.title)
    );
    cache.set(paperId, explanation);
    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("[/api/explain] failed:", err);
    return NextResponse.json({ error: "Failed to generate explanation" }, { status: 500 });
  }
}
