import { describe, it, expect, vi } from "vitest";
import { parseCommand } from "./parser";

// These exercise only the deterministic rule-based branches (no network) —
// every phrase below is chosen to match a rule before parseCommand would
// ever fall through to the LLM.
describe("parseCommand — precedence (temporal phrase must not swallow a more specific intent)", () => {
  it('"Show me new SSM research this week" stays topic-specific, not generic "today"', async () => {
    const result = await parseCommand("Show me new SSM research this week");
    expect(result.intent).toBe("topic_research");
    expect(result.topicSlug).toBe("ssms");
    expect(result.sinceDate).not.toBeNull();
  });

  it('"What new reasoning research came out yesterday?" resolves to the reasoning topic', async () => {
    const result = await parseCommand("What new reasoning research came out yesterday?");
    expect(result.intent).toBe("topic_research");
    expect(result.topicSlug).toBe("reasoning");
    expect(result.sinceDate).not.toBeNull();
  });

  it('"Show me SSM papers from the last 7 days" carries both topic and date', async () => {
    const result = await parseCommand("Show me SSM papers from the last 7 days");
    expect(result.intent).toBe("topic_research");
    expect(result.topicSlug).toBe("ssms");
    expect(result.sinceDate).not.toBeNull();
  });

  it('"What changed in agents this week?" resolves to the AI agents topic, not "today"', async () => {
    const result = await parseCommand("What changed in agents this week?");
    expect(result.intent).toBe("topic_research");
    expect(result.topicSlug).toBe("ai-agents");
  });

  it('"What are the latest AI model releases this week" stays model_releases, not "today"', async () => {
    const result = await parseCommand("What are the latest AI model releases this week");
    expect(result.intent).toBe("model_releases");
    expect(result.sinceDate).not.toBeNull();
  });

  it('"Show me open source projects this week" stays open_source, not "today"', async () => {
    const result = await parseCommand("Show me open source projects this week");
    expect(result.intent).toBe("open_source");
  });

  it('a bare date question with no topic/content-type falls back to "today"', async () => {
    const result = await parseCommand("What changed today?");
    expect(result.intent).toBe("today");
  });

  it('"What changed in AI since my last check?" resolves to since_last_check', async () => {
    const result = await parseCommand("What changed in AI since my last check?");
    expect(result.intent).toBe("since_last_check");
  });

  it('"What should I read next about SSM?" resolves to recommendations with the topic attached', async () => {
    const result = await parseCommand("What should I read next about SSM?");
    expect(result.intent).toBe("recommendations");
    expect(result.topicSlug).toBe("ssms");
  });
});
