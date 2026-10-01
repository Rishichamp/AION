export const summarizePrompt = (title: string, body: string) => `
You summarize AI research/news for an expert audience (AI researchers, engineers, instructors).
Given the item below, respond with JSON: { "summary": string, "keyPoint": string, "topics": string[] }
- "summary": 1-2 plain sentences, no fluff, no hype adjectives.
- "keyPoint": one sentence on the single most important takeaway ("why it matters").
- "topics": up to 4 topics from this fixed set: LLMs, SSMs, Reasoning, AI Agents, Agentic AI, Multimodal AI,
  Generative AI, Computer Vision, RAG, World Models, Robotics, AI Safety, Alignment, AI Infrastructure,
  Open Source AI, New AI Models.

TITLE: ${title}
CONTENT: ${body.slice(0, 4000)}
`;

export const scorePrompt = (title: string, summary: string, sourceQuality: number) => `
Score this AI item for an expert reader. Respond with JSON:
{ "importance": number, "novelty": number, "relevance": number }
Each 0.0-1.0. importance = how significant/consequential; novelty = how new an idea/result vs
incremental; relevance = general relevance to AI research/engineering (not personalized yet).
Source quality signal (0-1, already known): ${sourceQuality}

TITLE: ${title}
SUMMARY: ${summary}
`;

export const radarBriefPrompt = (args: {
  userInterests: string[];
  developments: { candidateId: string; title: string; summary: string; keyPoint: string }[];
  candidatePapers: { candidateId: string; title: string; summary: string; keyPoint: string }[];
}) => `
You are AION, a personal AI research radar. Write a concise "since you last checked" briefing for
someone interested in: ${args.userInterests.join(", ") || "general AI progress"}.

Respond with JSON:
{
  "summary": string,               // 1 sentence framing the update
  "developments": [{ "candidateId": string, "whyItMatters": string }],
  "recommendations": [{ "candidateId": string, "whyRead": string }]
}

Pick at most 5 developments and 3 recommendations — the most important ones, not everything.
Every "candidateId" MUST be copied EXACTLY from the candidate lists below — do not invent one,
do not use a title or URL as the id. Only choose from the ids given.

CANDIDATE DEVELOPMENTS:
${args.developments.map((d) => `[${d.candidateId}] ${d.title} — ${d.summary}`).join("\n")}

CANDIDATE PAPERS:
${args.candidatePapers.map((p) => `[${p.candidateId}] ${p.title} — ${p.summary}`).join("\n")}
`;

export const dailyBriefPrompt = (items: { title: string; summary: string; category: string }[]) => `
Write today's AI brief for an expert audience. Respond with JSON:
{ "headline": string, "sections": [{ "heading": string, "points": string[] }] }
Group into sections such as "New Models", "Research", "Open Source", "Companies & Labs" — only
include sections that have real items below. Keep each point to one sentence.

ITEMS:
${items.map((it, i) => `${i + 1}. [${it.category}] ${it.title} — ${it.summary}`).join("\n")}
`;

export const explainPaperPrompt = (title: string, abstract: string) => `
Explain this paper like an AI instructor, for someone who reads AI research but hasn't read this
specific paper. Respond with JSON:
{
  "problem": string,        // what problem is being addressed
  "motivation": string,     // why this problem matters / what was missing before
  "method": string,         // the core approach, in plain terms
  "contribution": string,   // the specific new thing this paper contributes
  "results": string,        // what they found/showed
  "limitations": string,    // caveats or open questions, if any are evident
  "whyItMatters": string,   // the practical takeaway
  "prerequisites": string   // background helpful to fully follow it, or "" if none needed
}
Base this only on the title and abstract given — do not invent specific numbers, datasets, or
results that aren't implied by the text below.

TITLE: ${title}
ABSTRACT: ${abstract}
`;

export const intentFallbackPrompt = (utterance: string) => `
Classify this AION command. Respond with JSON:
{
  "intent": "since_last_check" | "today" | "recent_research" | "topic_research" | "recommendations" | "model_releases" | "ai_news" | "open_source" | "daily_brief" | "search" | "unknown",
  "topic": string | null,
  "sinceDate": string | null   // ISO date if the user referenced a specific date/range, else null
}

UTTERANCE: "${utterance}"
`;

/** One call that does summarize + tag + score together — halves LLM usage vs
 *  the separate summarizePrompt/scorePrompt pair (matters on free tiers). */
export const enrichPrompt = (title: string, body: string, sourceQuality: number) => `
You summarize and score AI research/news for an expert audience (AI researchers, engineers, instructors).
Respond with JSON:
{ "summary": string, "keyPoint": string, "topics": string[], "importance": number, "novelty": number, "relevance": number }
- "summary": 1-2 plain sentences, no fluff, no hype adjectives.
- "keyPoint": one sentence on the single most important takeaway ("why it matters").
- "topics": up to 4 from this fixed set: LLMs, SSMs, Reasoning, AI Agents, Agentic AI, Multimodal AI,
  Generative AI, Computer Vision, RAG, World Models, Robotics, AI Safety, Alignment, AI Infrastructure,
  Open Source AI, New AI Models.
- "importance", "novelty", "relevance": each 0.0-1.0. importance = how significant/consequential;
  novelty = how new an idea/result vs incremental; relevance = relevance to AI research/engineering.
Source quality signal (0-1, already known): ${sourceQuality}

TITLE: ${title}
CONTENT: ${body.slice(0, 3000)}
`;
