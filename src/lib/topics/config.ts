export type TopicConfig = {
  slug: string;
  name: string;
  /** Plain description of what the topic covers — used for the topic page,
   *  never sent to the LLM as a definition to "explain" ambiguous terms. */
  description: string;
  aliases: string[];
  /** Marks terms whose exact scope is ambiguous/organization-specific. The
   *  LLM must never be asked to define these — see handling in classify.ts. */
  ambiguous?: boolean;
};

export const TOPICS: TopicConfig[] = [
  { slug: "llms", name: "LLMs", description: "Large language models.", aliases: ["llm", "large language model", "large language models"] },
  {
    slug: "ssms",
    name: "SSMs",
    description: "State space models, including selective SSMs (e.g. Mamba-style architectures).",
    aliases: ["ssm", "state space model", "state space models", "state-space model", "state-space models", "selective state space model", "selective state space models", "mamba"]
  },
  {
    slug: "som-intelligence",
    name: "SOM Intelligence",
    description: "Placeholder topic — scope not yet configured. \"SOM\" is ambiguous (e.g. self-organizing maps vs an org-specific term); content is only tagged here when a source explicitly uses this label, never inferred by the LLM.",
    aliases: ["som", "som intelligence", "self-organizing map", "self organizing map"],
    ambiguous: true
  },
  {
    slug: "okf-intelligence",
    name: "OKF Intelligence",
    description: "Placeholder topic — scope not yet configured. \"OKF\" has no fixed, widely-agreed meaning in AI research; content is only tagged here when a source explicitly uses this label, never inferred by the LLM.",
    aliases: ["okf", "okf intelligence"],
    ambiguous: true
  },
  { slug: "reasoning", name: "Reasoning", description: "Chain-of-thought, planning, and multi-step inference in models.", aliases: ["reasoning", "chain of thought", "chain-of-thought", "cot"] },
  { slug: "ai-agents", name: "AI Agents", description: "Autonomous or semi-autonomous LLM-driven agents.", aliases: ["ai agent", "ai agents", "agent", "agents"] },
  { slug: "agentic-ai", name: "Agentic AI", description: "Systems designed around agentic, goal-directed behavior.", aliases: ["agentic ai", "agentic"] },
  { slug: "multimodal-ai", name: "Multimodal AI", description: "Models spanning text, image, audio, and/or video.", aliases: ["multimodal", "multimodal ai", "multi-modal"] },
  { slug: "generative-ai", name: "Generative AI", description: "Generative models broadly (text, image, audio, video).", aliases: ["generative ai", "genai", "gen ai"] },
  { slug: "computer-vision", name: "Computer Vision", description: "Image/video understanding and generation.", aliases: ["computer vision", "cv"] },
  { slug: "rag", name: "RAG", description: "Retrieval-augmented generation.", aliases: ["rag", "retrieval augmented generation", "retrieval-augmented generation"] },
  {
    slug: "cag",
    name: "CAG",
    description: "Placeholder topic — \"CAG\" (e.g. cache-augmented generation) scope not yet configured; only tagged from explicit source labels.",
    aliases: ["cag"],
    ambiguous: true
  },
  {
    slug: "mag",
    name: "MAG",
    description: "Placeholder topic — \"MAG\" scope not yet configured; only tagged from explicit source labels.",
    aliases: ["mag"],
    ambiguous: true
  },
  { slug: "world-models", name: "World Models", description: "Models that learn predictive internal representations of an environment.", aliases: ["world model", "world models"] },
  { slug: "robotics", name: "Robotics", description: "Embodied AI and robotics.", aliases: ["robotics", "robot", "robots"] },
  { slug: "ai-safety", name: "AI Safety", description: "Safety research broadly (robustness, evals, misuse prevention).", aliases: ["ai safety", "safety"] },
  { slug: "alignment", name: "Alignment", description: "Value/intent alignment research.", aliases: ["alignment", "rlhf"] },
  { slug: "ai-infrastructure", name: "AI Infrastructure", description: "Training/inference infrastructure, chips, systems.", aliases: ["ai infrastructure", "infra", "infrastructure"] },
  { slug: "new-ai-models", name: "New AI Models", description: "New model releases broadly.", aliases: ["new ai models", "new models", "model release", "model releases"] },
  { slug: "open-source-ai", name: "Open Source AI", description: "Open-source/open-weight AI projects and releases.", aliases: ["open source ai", "open-source ai", "open source", "oss"] }
];

/** Longest-alias-first matching so "state space models" wins over a shorter
 *  accidental substring match elsewhere in the utterance. */
export function matchTopic(text: string): TopicConfig | null {
  const lower = text.toLowerCase();
  const candidates = TOPICS
    .flatMap((t) => t.aliases.map((alias) => ({ topic: t, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { topic, alias } of candidates) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (re.test(lower)) return topic;
  }
  return null;
}

export function getTopicBySlug(slug: string): TopicConfig | undefined {
  return TOPICS.find((t) => t.slug === slug);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
