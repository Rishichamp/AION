import type { SourceConnector } from "./types";

// Hugging Face's public model listing API — no auth required for public
// models: https://huggingface.co/docs/hub/api
export const huggingFaceModelsConnector: SourceConnector = {
  name: "Hugging Face Models",
  category: "models",
  async fetch(sinceIso) {
    try {
      const url = "https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=40&full=true";
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`Hugging Face API responded ${res.status}`);
      const data = await res.json();

      const since = sinceIso ? new Date(sinceIso) : null;

      return (data ?? [])
        .filter((m: any) => m.createdAt)
        .map((m: any) => {
          const [org, ...nameParts] = String(m.modelId ?? m.id ?? "").split("/");
          const name = nameParts.length > 0 ? nameParts.join("/") : org;
          const organization = nameParts.length > 0 ? org : "Hugging Face community";
          return {
            kind: "model" as const,
            title: name || m.id,
            url: `https://huggingface.co/${m.modelId ?? m.id}`,
            publishedAt: new Date(m.createdAt),
            organization,
            modelType: (m.pipeline_tag as string) ?? undefined,
            capabilities: m.tags ?? [],
            description: undefined // HF's listing API doesn't include a model card summary; never fabricate one
          };
        })
        .filter((it: any) => !since || it.publishedAt > since);
    } catch (err) {
      console.error("[huggingFaceModelsConnector] failed:", err);
      return [];
    }
  }
};
