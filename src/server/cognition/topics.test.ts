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
});
