import { afterEach, describe, expect, it, vi } from "vitest";
import { computeThreadContext, deriveCaptureSummary } from "@/server/services/cognition";
import { generateRecommendations } from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deriveCaptureSummary", () => {
  const transcript =
    "so today we're going to talk about attention and what it actually does inside a transformer. " +
    "and the first thing to notice is that the model is not reading left to right the way you do. " +
    "it's routing information between every pair of tokens at once, which is the whole trick here. ".repeat(20);

  it("keeps a short cleaned excerpt", () => {
    const excerpt = "A walkthrough of how attention routes information between tokens in a transformer.";
    expect(deriveCaptureSummary(excerpt, transcript)).toBe(excerpt);
  });

  it("rejects a transcript echoed into the description", () => {
    expect(deriveCaptureSummary(transcript, transcript)).toBeNull();
  });

  it("rejects a transcript prefix echoed into the description", () => {
    expect(deriveCaptureSummary(transcript.slice(0, 500), transcript)).toBeNull();
  });

  it("rejects a URL-shaped stub description", () => {
    expect(deriveCaptureSummary("https://example.com/a-video", undefined)).toBeNull();
  });

  it("cuts a long-but-real description at its last full sentence", () => {
    const lead =
      "Spaced repetition is a learning technique that schedules reviews at increasing intervals. " +
      "It exploits the spacing effect, the finding that memory is better served by distributed practice than by massed practice. " +
      "The technique is most often applied with flashcards, where each card carries its own schedule. " +
      "Modern implementations derive their scheduling from the SuperMemo family of algorithms. " +
      "This paragraph continues well past the display cap so the truncation path is exercised.";
    const summary = deriveCaptureSummary(lead, "An entirely different article body about something else.");
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(400);
    expect(summary!.endsWith(".")).toBe(true);
    expect(summary).toContain("spacing effect");
  });

  it("returns null for a long blob with no sentence to cut on", () => {
    expect(deriveCaptureSummary("word ".repeat(200), undefined)).toBeNull();
  });
});

describe("computeThreadContext", () => {
  it("returns null when topicCounts is empty", () => {
    expect(computeThreadContext([])).toBeNull();
  });

  it("returns null when the top topic count is 1 (first capture on that topic)", () => {
    expect(computeThreadContext([
      { topicId: "t1", name: "existentialism", count: 1 },
    ])).toBeNull();
  });

  it("returns the top topic when count >= 2", () => {
    expect(computeThreadContext([
      { topicId: "t1", name: "existentialism", count: 4 },
      { topicId: "t2", name: "phenomenology", count: 2 },
    ])).toEqual({ topicName: "existentialism", captureCount: 4 });
  });

  it("uses the first entry (highest count) when multiple topics qualify", () => {
    expect(computeThreadContext([
      { topicId: "t1", name: "consciousness studies", count: 3 },
      { topicId: "t2", name: "hard problem", count: 5 },
    ])).toEqual({ topicName: "consciousness studies", captureCount: 3 });
  });
});

describe("generateRecommendations", () => {
  it("returns empty array when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: ["philosophy"],
      neighborTitles: [],
    });
    expect(result).toEqual([]);
  });

  it("returns 3 recommendations from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              recommendations: [
                { title: "Being and Time", author: "Martin Heidegger", why: "Grounds Sartre's account of radical freedom in the structure of Dasein's being-toward-death." },
                { title: "Existentialism Is a Humanism", author: "Jean-Paul Sartre", why: "The lecture where Sartre directly addresses the charge that existentialism leads to despair." },
                { title: "The Myth of Sisyphus", author: "Albert Camus", why: "Offers the absurdist counter to existentialist bad faith — confronts the same problem from outside the tradition." },
              ],
            }),
          },
        }],
      }),
    }));

    const result = await generateRecommendations({
      itemTitle: "No Exit",
      topicNames: ["existentialism", "bad faith"],
      neighborTitles: [],
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      title: "Being and Time",
      author: "Martin Heidegger",
      why: "Grounds Sartre's account of radical freedom in the structure of Dasein's being-toward-death.",
    });
  });

  it("returns empty array when the API response is malformed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    }));

    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: [],
      neighborTitles: [],
    });

    expect(result).toEqual([]);
  });

  it("filters out recommendations missing required fields", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              recommendations: [
                { title: "Good Book", author: "Someone", why: "Good reason" },
                { title: "Missing author", why: "reason" },
                { author: "Missing title", why: "reason" },
              ],
            }),
          },
        }],
      }),
    }));

    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: [],
      neighborTitles: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Good Book");
  });

  it("returns empty array when fetch fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: [],
      neighborTitles: [],
    });

    expect(result).toEqual([]);
  });
});
