/** Thrown for anything that means an AI call can't succeed right now —
 *  quota exhausted, a persistent provider outage (5xx) after retries, a
 *  network failure, or two failed attempts at getting valid JSON back.
 *  Callers should degrade to a non-AI fallback rather than crash. */
export class AIQuotaError extends Error {
  retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "AIQuotaError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Duck-typed on purpose: works even if the AI client module is mocked. */
export function isAIQuotaError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AIQuotaError";
}
