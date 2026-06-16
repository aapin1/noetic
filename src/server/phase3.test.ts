import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePositionTension } from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("evaluatePositionTension", () => {
  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Hard Determinism",
      captureText: "Every event is causally necessitated by prior events.",
    });
    expect(result).toBeNull();
  });

  it("returns null when has_tension is false", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tension: null, has_tension: false }) } }],
      }),
    }));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Libertarian Agency",
      captureText: "Agent causation grounds genuine freedom.",
    });
    expect(result).toBeNull();
  });

  it("returns the tension string when has_tension is true", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const tension = "The capture's causal closure argument directly undermines the position's agent-causal premise.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tension, has_tension: true }) } }],
      }),
    }));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Hard Determinism",
      captureText: "Every event is causally necessitated.",
    });
    expect(result).toBe(tension);
  });

  it("returns null when fetch is not ok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Any",
      captureText: "Any.",
    });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Any",
      captureText: "Any.",
    });
    expect(result).toBeNull();
  });
});
