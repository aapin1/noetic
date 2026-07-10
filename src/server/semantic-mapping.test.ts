import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { cleanContentMetadata, embedText, extractSemanticTopics } from "@/server/cognition/llm";
import { classifyTopics } from "@/server/cognition/topics";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockOpenAI(content: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
    }),
  );
}

/** Fake db whose userTopic list seeds the keyword-fallback candidate set. */
function fallbackDb(
  topics: { id: string; name: string; slug: string; description?: string | null }[],
): DbClient {
  return {
    userTopic: {
      findMany: vi.fn(async () =>
        topics.map((t) => ({ topicId: t.id, topic: { description: null, ...t } })),
      ),
    },
    capturedItemTopic: {
      findMany: vi.fn(async () => []),
    },
    topic: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create }: { create: { name: string; slug: string } }) => ({
        id: `id-${create.slug}`,
        name: create.name,
        slug: create.slug,
      })),
    },
  } as unknown as DbClient;
}

describe("extractSemanticTopics", () => {
  it("returns an empty result when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await extractSemanticTopics({ title: "Anything", combinedText: "x".repeat(80) });
    expect(result).toEqual({ classifications: [] });
  });

  it("parses a (general, specific) pair from a valid response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({ classifications: [{ general: "Science", specific: "Quantum Mechanics" }] });
    const result = await extractSemanticTopics({
      title: "How decoherence resolves the measurement problem",
      combinedText: "A long piece about quantum theory.".repeat(4),
    });
    expect(result.classifications).toEqual([{ general: "science", specific: "quantum mechanics" }]);
  });

  it("keeps up to three fields for interdisciplinary content and dedupes generals", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({
      classifications: [
        { general: "science", specific: "quantum physics" },
        { general: "philosophy", specific: "free will" },
        { general: "science", specific: "thermodynamics" }, // duplicate general → dropped
      ],
    });
    const result = await extractSemanticTopics({
      title: "What quantum physics says about free will",
      combinedText: "An interdisciplinary essay.".repeat(4),
    });
    expect(result.classifications).toEqual([
      { general: "science", specific: "quantum physics" },
      { general: "philosophy", specific: "free will" },
    ]);
  });

  it("rejects free-form generals not in the fixed field list", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({ classifications: [{ general: "astrology", specific: "natal charts" }] });
    const result = await extractSemanticTopics({
      title: "Reading the stars",
      combinedText: "x".repeat(80),
    });
    expect(result.classifications).toEqual([]);
  });

  it("includes the word 'json' in the prompt so OpenAI accepts json_object mode", async () => {
    // OpenAI 400s any response_format:json_object request whose messages omit
    // the literal word "json". Without this guard the call fails on every
    // capture and silently drops to the keyword/general fallback.
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ classifications: [] }) } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractSemanticTopics({ title: "Anything", combinedText: "x".repeat(80) });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body.messages)).toMatch(/json/i);
  });
});

describe("embedText", () => {
  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await embedText("some content")).toBeNull();
  });

  it("returns the embedding vector from a valid response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      }),
    );
    expect(await embedText("quantum mechanics")).toEqual([0.1, 0.2, 0.3]);
  });
});

describe("cleanContentMetadata", () => {
  it("returns null without an API key (caller keeps raw values)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await cleanContentMetadata({ rawTitle: "X — by Jane | Substack" })).toBeNull();
  });

  it("separates author from title and surfaces a clean excerpt", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({ title: "The Shape of Doubt", author: "Jane Doe", excerpt: "An essay on epistemic humility." });
    const result = await cleanContentMetadata({
      rawTitle: "The Shape of Doubt — by Jane Doe | Substack",
      rawDescription: "Subscribe now to get more posts like this!",
    });
    expect(result).toEqual({
      title: "The Shape of Doubt",
      author: "Jane Doe",
      excerpt: "An essay on epistemic humility.",
    });
  });
});

describe("classifyTopics — LLM path", () => {
  it("places the general field first at 1.0, then its specific topic", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({ classifications: [{ general: "science", specific: "quantum mechanics" }] });
    const db = fallbackDb([]); // user has NO topics — proves topics aren't limited to picks

    const result = await classifyTopics({
      db,
      userId: "u1",
      tokens: ["quantum", "decoherence", "measurement"],
      title: "How decoherence resolves the measurement problem",
      combinedText: "A long piece about quantum theory and the measurement problem.".repeat(3),
    });

    expect(result.length).toBe(2);
    expect(result[0]!.name).toBe("science");
    expect(result[0]!.kind).toBe("general");
    expect(result[0]!.score).toBe(1);
    expect(result[1]!.name).toBe("quantum mechanics");
    expect(result[1]!.kind).toBe("specific");
    // The general anchor must outrank the specific topic.
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });

  it("keeps up to three general anchors for interdisciplinary content", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({
      classifications: [
        { general: "science", specific: "quantum physics" },
        { general: "philosophy", specific: "free will" },
      ],
    });
    const db = fallbackDb([]);

    const result = await classifyTopics({
      db,
      userId: "u1",
      tokens: ["quantum", "physics", "free", "will"],
      title: "What quantum physics says about free will",
      combinedText: "An interdisciplinary essay about physics and philosophy.".repeat(3),
    });

    const generals = result.filter((r) => r.kind === "general").map((r) => r.name);
    expect(generals).toEqual(["science", "philosophy"]);
    expect(result[0]!.score).toBe(1); // primary field leads
    const specifics = result.filter((r) => r.kind === "specific").map((r) => r.name);
    expect(specifics).toContain("quantum physics");
    expect(specifics).toContain("free will");
  });
});

describe("classifyTopics — keyword fallback", () => {
  it("does not misclassify on a single stray token (science is not tagged 'film')", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); // force fallback
    // Dominant declared field first so the guaranteed-general anchor is 'science'.
    const db = fallbackDb([
      { id: "science", name: "science", slug: "science" },
      { id: "film", name: "film", slug: "film" },
    ]);

    const result = await classifyTopics({
      db,
      userId: "u1",
      // A science capture that incidentally contains the token "film" (e.g. "thin film").
      tokens: ["semiconductor", "thin", "film", "deposition", "lattice"],
    });

    // The stray "film" token must not score-classify the capture as film.
    expect(result.map((r) => r.name)).not.toContain("film");
    // Every node still ends up with a general field.
    expect(result.some((r) => r.kind === "general")).toBe(true);
  });

  it("still classifies on a genuine multi-token match", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const db = fallbackDb([
      { id: "science", name: "science", slug: "science" },
      { id: "qp", name: "quantum physics", slug: "quantum-physics" },
      { id: "film", name: "film", slug: "film" },
    ]);

    const result = await classifyTopics({
      db,
      userId: "u1",
      tokens: ["quantum", "physics", "entanglement", "film"],
    });

    const names = result.map((r) => r.name);
    expect(names).toContain("quantum physics");
    expect(names).not.toContain("film");
    // Guaranteed general anchor comes from the user's dominant declared field.
    expect(result.some((r) => r.kind === "general")).toBe(true);
  });
});
