import type { SourceConnector } from "./types";

// OpenAlex is free and keyless: https://docs.openalex.org
//
// Filter note: the old query used `concepts.id:C154945302` (the broad "Artificial
// intelligence" concept). OpenAlex tags that concept loosely onto papers from many
// unrelated fields (botany, archaeology, ...). We now filter on the paper's PRIMARY
// topic belonging to the "Artificial Intelligence" subfield instead, which is much
// stricter. Subfield 1702 = Artificial Intelligence (verify: api.openalex.org/subfields/1702).
const AI_SUBFIELD_ID = "1702";

// OpenAlex files some clearly non-AI topics under the AI subfield. Papers whose
// PRIMARY topic is one of these are dropped client-side.
const BLOCKED_TOPIC_IDS = new Set([
  "T11276", // Solar Radiation and Photovoltaics
  "T12157", // Geochemistry and Geologic Mapping
  "T13018", // Seismology and Earthquake Studies
  "T13650", // Computational Physics and Python Applications
  "T10020", // Quantum Information and Cryptography
  "T10682", // Quantum Computing Algorithms and Architecture
  "T12131", // Wireless Signal Modulation Classification
  "T13623", // Linguistic Studies and Language Acquisition
  "T14381", // Psychiatry, Mental Health, Neuroscience
  "T14064", // Organizational and Employee Performance
  "T13898", // Diverse Interdisciplinary Research Studies
  "T14413", // Advanced Technologies in Various Fields
  "T13514", // Experience-Based Knowledge Management
  "T11598", // Internet Traffic Analysis and Secure E-voting
  "T10951", // Cryptographic Implementations and Security
  "T11130", // Coding theory and cryptography
  "T10237", // Cryptography and Data Security
  "T12260", // Educational Technology and Pedagogy
  "T13559", // Educational Technology Systems
  "T14335", // Educational Robotics and Engineering
  "T13398", // Data Analysis with R
  "T10711", // Target Tracking and Data Fusion in Sensor Networks
  "T10820", // Fuzzy Logic and Control Systems
  "T13935", // Mathematical Control Systems and Analysis
  "T14175", // Intuitionistic Fuzzy Systems Applications
  "T10126", // Logic, programming, and type systems
  "T10639", // Advanced Software Engineering Methodologies
  "T10215", // Semantic Web and Ontologies
  "T14351", // Statistical and Computational Modeling
  "T13734"  // Advanced Computational Techniques and Applications
]);

function topicIdOf(w: any): string | undefined {
  // primary_topic.id looks like "https://openalex.org/T12072"
  return w?.primary_topic?.id?.split("/").pop();
}

export const openAlexConnector: SourceConnector = {
  name: "OpenAlex",
  category: "research",
  async fetch(sinceIso) {
    try {
      const since = sinceIso ? sinceIso.slice(0, 10) : daysAgo(3);
      const url =
        `https://api.openalex.org/works?filter=primary_topic.subfield.id:${AI_SUBFIELD_ID},from_publication_date:${since}` +
        `&sort=publication_date:desc&per_page=100&mailto=aion@example.com`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`OpenAlex responded ${res.status}`);
      const data = await res.json();

      return (data.results ?? [])
        .filter((w: any) => !BLOCKED_TOPIC_IDS.has(topicIdOf(w) ?? ""))
        .map((w: any) => ({
        kind: "paper" as const,
        title: w.display_name ?? "Untitled",
        url: w.doi ? `https://doi.org/${w.doi.replace("https://doi.org/", "")}` : w.id,
        publishedAt: w.publication_date ? new Date(w.publication_date) : null, // never fabricate a publish date
        authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
        doi: w.doi?.replace("https://doi.org/", ""),
        categories: (w.concepts ?? []).slice(0, 5).map((c: any) => c.display_name),
        description: reconstructAbstract(w.abstract_inverted_index)
      }));
    } catch (err) {
      console.error("[openAlexConnector] failed:", err);
      return [];
    }
  }
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** OpenAlex stores abstracts as an inverted index - {word: [position, ...]} -
 *  to save space. Rebuild the plain-text abstract from it; without this,
 *  every OpenAlex paper was being ingested with title + metadata but no
 *  usable text for summarization, ranking, or search. */
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string | undefined {
  if (!invertedIndex) return undefined;

  const positions: { word: string; pos: number }[] = [];
  for (const [word, occurrences] of Object.entries(invertedIndex)) {
    for (const pos of occurrences) positions.push({ word, pos });
  }
  if (positions.length === 0) return undefined;

  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(" ");
}
