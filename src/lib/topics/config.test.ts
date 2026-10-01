import { describe, it, expect } from "vitest";
import { matchTopic, getTopicBySlug } from "./config";

describe("matchTopic", () => {
  it("resolves common SSM aliases to the same topic", () => {
    const bySlang = matchTopic("new mamba architecture paper");
    const byFullName = matchTopic("a state space model breakthrough");
    const byAcronym = matchTopic("SSM research this week");
    expect(bySlang?.slug).toBe("ssms");
    expect(byFullName?.slug).toBe("ssms");
    expect(byAcronym?.slug).toBe("ssms");
  });

  it("does not match a substring inside an unrelated word", () => {
    // "rag" is a topic alias; "dragon" must not match it.
    expect(matchTopic("tell me about dragons")).toBeNull();
  });

  it("prefers the longer, more specific alias when multiple could match", () => {
    const match = matchTopic("what's new in agentic ai this week");
    expect(match?.slug).toBe("agentic-ai");
  });

  it("returns null when nothing matches", () => {
    expect(matchTopic("what's the weather like")).toBeNull();
  });

  it("flags ambiguous topics (OKF/SOM) so the LLM is never asked to define them", () => {
    const okf = getTopicBySlug("okf-intelligence");
    const som = getTopicBySlug("som-intelligence");
    expect(okf?.ambiguous).toBe(true);
    expect(som?.ambiguous).toBe(true);
  });
});
