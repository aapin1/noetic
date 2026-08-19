import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePositionTension, generateSocraticOpening, generateSocraticResponse } from "@/server/cognition/llm";

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

// ── generateSocraticOpening ───────────────────────────────────────────────────

describe("generateSocraticOpening", () => {
  const captures = [
    { label: "Capture A", keyIdea: "hard problem", text: "Consciousness is irreducible." },
    { label: "Capture B", keyIdea: "qualia", text: "Phenomenal states cannot be functionally defined." },
  ];

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateSocraticOpening({
      topicName: "consciousness",
      positionStatement: null,
      captures,
    });
    expect(result).toBeNull();
  });

  it("returns the challenge string from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ challenge: "What grounds the irreducibility claim?" }) } }],
      }),
    }));
    const result = await generateSocraticOpening({
      topicName: "consciousness",
      positionStatement: "Consciousness is not reducible to physical processes.",
      captures,
    });
    expect(result).toBe("What grounds the irreducibility claim?");
  });

  it("returns null when fetch is not ok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await generateSocraticOpening({ topicName: "consciousness", positionStatement: null, captures });
    expect(result).toBeNull();
  });

  it("returns null when challenge field is empty", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ challenge: "" }) } }],
      }),
    }));
    const result = await generateSocraticOpening({ topicName: "consciousness", positionStatement: null, captures });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await generateSocraticOpening({ topicName: "consciousness", positionStatement: null, captures });
    expect(result).toBeNull();
  });
});

// ── generateSocraticResponse ─────────────────────────────────────────────────

describe("generateSocraticResponse", () => {
  const history = [
    { role: "COMPANION" as const, content: "What grounds your claim?" },
    { role: "USER" as const, content: "I think qualia are irreducible because..." },
  ];

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateSocraticResponse({
      topicName: "consciousness",
      positionStatement: null,
      captures: [],
      conversationHistory: history,
      userReply: "My reply.",
    });
    expect(result).toBeNull();
  });

  it("returns the follow-up challenge from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ challenge: "But does that argument beg the question?" }) } }],
      }),
    }));
    const result = await generateSocraticResponse({
      topicName: "consciousness",
      positionStatement: "Consciousness is irreducible.",
      captures: [{ label: "Capture A", keyIdea: "hard problem" }],
      conversationHistory: history,
      userReply: "Qualia cannot be functionally described.",
    });
    expect(result).toBe("But does that argument beg the question?");
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const result = await generateSocraticResponse({
      topicName: "consciousness",
      positionStatement: null,
      captures: [],
      conversationHistory: history,
      userReply: "reply",
    });
    expect(result).toBeNull();
  });
});
