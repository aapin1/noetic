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
    expect(result).toEqual({ domain: null, topics: [] });
  });

  it("parses a domain plus specific topics from a valid response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({ domain: "Science", topics: ["Quantum Mechanics", "Decoherence"] });
    const result = await extractSemanticTopics({
      title: "How decoherence resolves the measurement problem",
      combinedText: "A long piece about quantum theory.".repeat(4),
    });
    expect(result.domain).toBe("science");
    expect(result.topics).toEqual(["quantum mechanics", "decoherence"]);
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
  it("places the coarse domain first with the highest score, then specific topics", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mockOpenAI({ domain: "science", topics: ["quantum mechanics", "decoherence"] });
    const db = fallbackDb([]); // user has NO topics — proves topics aren't limited to picks

    const result = await classifyTopics({
      db,
      userId: "u1",
      tokens: ["quantum", "decoherence", "measurement"],
      title: "How decoherence resolves the measurement problem",
      combinedText: "A long piece about quantum theory and the measurement problem.".repeat(3),
    });

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result[0]!.name).toBe("science");
    expect(result[0]!.score).toBe(1);
    const names = result.map((r) => r.name);
    expect(names).toContain("quantum mechanics");
    expect(names).toContain("decoherence");
    // Domain anchor must outrank every specific topic.
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });
});

describe("classifyTopics — keyword fallback", () => {
  it("does not misclassify on a single stray token (science is not tagged 'film')", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); // force fallback
    const db = fallbackDb([
      { id: "film", name: "film", slug: "film" },
    ]);

    const result = await classifyTopics({
      db,
      userId: "u1",
      // A science capture that incidentally contains the token "film" (e.g. "thin film").
      tokens: ["semiconductor", "thin", "film", "deposition", "lattice"],
    });

    expect(result.map((r) => r.name)).not.toContain("film");
  });

  it("still classifies on a genuine multi-token match", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const db = fallbackDb([
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
  });
});
