import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateContradictionTension,
  generateThreadSynthesis,
  generateConvergenceSignal,
} from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── generateContradictionTension ─────────────────────────────────────────────

describe("generateContradictionTension", () => {
  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateContradictionTension({
      labelA: "A", textA: "text A", labelB: "B", textB: "text B",
    });
    expect(result).toBeNull();
  });

  it("returns the tension string from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tension: "A holds X while B holds Y." }) } }],
      }),
    }));
    const result = await generateContradictionTension({
      labelA: "A", textA: "text A", labelB: "B", textB: "text B",
    });
    expect(result).toBe("A holds X while B holds Y.");
  });

  it("returns null when API response is not ok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await generateContradictionTension({
      labelA: "A", textA: "", labelB: "B", textB: "",
    });
    expect(result).toBeNull();
  });

  it("returns null when tension field is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ other: "field" }) } }] }),
    }));
    const result = await generateContradictionTension({
      labelA: "A", textA: "", labelB: "B", textB: "",
    });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await generateContradictionTension({
      labelA: "A", textA: "", labelB: "B", textB: "",
    });
    expect(result).toBeNull();
  });
});

// ── generateThreadSynthesis ───────────────────────────────────────────────────

describe("generateThreadSynthesis", () => {
  const fiveCaptures = Array.from({ length: 5 }, (_, i) => ({
    label: `Capture ${i}`,
    keyIdea: `idea ${i}`,
    text: `text ${i}`,
  }));

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateThreadSynthesis({
      topicName: "consciousness", captures: fiveCaptures,
    });
    expect(result).toBeNull();
  });

  it("returns null when fewer than 5 captures are provided", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const result = await generateThreadSynthesis({
      topicName: "consciousness",
      captures: fiveCaptures.slice(0, 4),
    });
    expect(result).toBeNull();
  });

  it("returns position and openQuestion from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              position: "You appear to believe consciousness is irreducible.",
              open_question: "Does irreducibility imply substance dualism or merely explanatory gap?",
            }),
          },
        }],
      }),
    }));
    const result = await generateThreadSynthesis({
      topicName: "consciousness", captures: fiveCaptures,
    });
    expect(result).toEqual({
      position: "You appear to believe consciousness is irreducible.",
      openQuestion: "Does irreducibility imply substance dualism or merely explanatory gap?",
    });
  });

  it("returns null when position or open_question is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ position: "Only position, no question." }) } }],
      }),
    }));
    const result = await generateThreadSynthesis({
      topicName: "consciousness", captures: fiveCaptures,
    });
    expect(result).toBeNull();
  });
});

// ── generateConvergenceSignal ─────────────────────────────────────────────────

describe("generateConvergenceSignal", () => {
  const diverseCaptures = [
    { label: "A", source: "The Atlantic", keyIdea: "idea A" },
    { label: "B", source: "Stanford Encyclopedia", keyIdea: "idea B" },
    { label: "C", source: "Nature", keyIdea: "idea C" },
  ];

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateConvergenceSignal({
      topicName: "free will", captures: diverseCaptures,
    });
    expect(result).toBeNull();
  });

  it("returns the signal string from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ signal: "From physics, philosophy, and literature you keep landing on: agency requires indeterminacy." }) } }],
      }),
    }));
    const result = await generateConvergenceSignal({
      topicName: "free will", captures: diverseCaptures,
    });
    expect(result).toBe("From physics, philosophy, and literature you keep landing on: agency requires indeterminacy.");
  });

  it("returns null when signal field is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ other: "field" }) } }] }),
    }));
    const result = await generateConvergenceSignal({
      topicName: "free will", captures: diverseCaptures,
    });
    expect(result).toBeNull();
  });
});
