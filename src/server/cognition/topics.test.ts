import { describe, expect, it, vi } from "vitest";
import { classifyTopics } from "@/server/cognition/topics";
import { extractSemanticTopics } from "@/server/cognition/llm";

vi.mock("@/server/cognition/llm", () => ({
  extractSemanticTopics: vi.fn(),
}));

describe("classifyTopics", () => {
  it("does not anchor genuinely unrelated content to the user's dominant existing topic when classification fails", async () => {
    // Simulates an LLM outage: extractSemanticTopics returns no classifications,
    // and the content shares no keywords with any topic the user already has.
    vi.mocked(extractSemanticTopics).mockResolvedValue({ classifications: [] });

    const db = {
      userTopic: {
        findMany: vi.fn().mockResolvedValue([
          {
            topicId: "philosophy_id",
            weight: 10,
            topic: { id: "philosophy_id", name: "philosophy", slug: "philosophy", description: null },
          },
        ]),
      },
      capturedItemTopic: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      topic: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockImplementation(({ create }: { create: { name: string; slug: string } }) =>
          Promise.resolve({ id: `${create.slug}_id`, name: create.name, slug: create.slug }),
        ),
      },
    } as any;

    const result = await classifyTopics({
      db,
      userId: "user_1",
      tokens: ["coding", "artificial", "intelligence", "agents"],
      title: "How To Learn To Code In 2026",
      combinedText: "A long article about coding practices and AI agents in 2026, covering tooling and workflow changes.",
    });

    expect(result.map((t) => t.name)).not.toContain("philosophy");
  });

  it("offers existing specific topics to the classifier grouped by their general field", async () => {
    // The classifier must know which field each existing label lives under, so
    // it can only reuse a label from the field it actually picked — this is what
    // stops an AI article being filed under a biology field's "ai in biology".
    vi.mocked(extractSemanticTopics).mockResolvedValue({
      classifications: [{ general: "technology", specific: "large language models" }],
    });

    const db = {
      capturedItemTopic: {
        // Item A: science + ai in biology. Item B: philosophy + ethics.
        findMany: vi.fn().mockResolvedValue([
          { capturedItemId: "a", topic: { name: "science" } },
          { capturedItemId: "a", topic: { name: "ai in biology" } },
          { capturedItemId: "b", topic: { name: "philosophy" } },
          { capturedItemId: "b", topic: { name: "ethics" } },
        ]),
      },
      userTopic: { findMany: vi.fn().mockResolvedValue([]) },
      topic: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockImplementation(({ create }: { create: { name: string; slug: string } }) =>
          Promise.resolve({ id: `${create.slug}_id`, name: create.name, slug: create.slug }),
        ),
      },
    } as any;

    await classifyTopics({
      db,
      userId: "user_1",
      tokens: ["language", "models"],
      title: "How large language models work",
      combinedText: "A long article about the architecture of large language models and transformers.",
    });

    const passed = vi.mocked(extractSemanticTopics).mock.calls[0]![0].existingTopicsByGeneral!;
    expect(passed.science).toContain("ai in biology");
    expect(passed.philosophy).toContain("ethics");
    // "ai in biology" must NOT be attributed to any other field.
    expect(passed.philosophy ?? []).not.toContain("ai in biology");
  });
});
