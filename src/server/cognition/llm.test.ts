import { InsightType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightDraft } from "./insights";
import { generateMirror, polishInsights } from "./llm";

const NOVELTY_DRAFT: InsightDraft = {
  type: InsightType.NOVELTY,
  headline: "Novel signal. First entry under psychology.",
  body: "Your first capture under psychology. Nothing of yours sits near it yet.",
  evidence: { dominantTopic: "psychology" },
  strength: 0.4,
};

/** Stubs fetch with one chat completion whose content is `content` as JSON. */
function mockChat(content: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The request body the helper sent, so the prompt itself can be asserted on. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>): {
  max_tokens: number;
  messages: { role: string; content: string }[];
} {
  const init = fetchMock.mock.calls[0]?.[1] as { body: string };
  return JSON.parse(init.body);
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("polishInsights — the READING", () => {
  it("returns the model's claim and catch as a READING draft beside the rewritten drafts", async () => {
    const fetchMock = mockChat({
      reading: {
        claim: "Public speaking nerves are a training problem, not a personality trait.",
        catch: "It assumes the nerves were ever the thing holding the talk back.",
      },
      insights: [{ index: 0, headline: "First under psychology.", body: "Nothing near it yet." }],
    });

    const result = await polishInsights({
      style: "DIRECT",
      itemTitle: "mental training is important!!",
      contentText: "A transcript about rehearsing under pressure so the stage feels familiar.",
      contentGrounding: "rich",
      drafts: [NOVELTY_DRAFT],
    });

    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].headline).toBe("First under psychology.");
    expect(result.reading).toMatchObject({
      type: InsightType.READING,
      headline: "Public speaking nerves are a training problem, not a personality trait.",
      body: "It assumes the nerves were ever the thing holding the talk back.",
      strength: 1,
      evidence: { grounding: "rich" },
    });
    // The contract is in the prompt and the output shape asks for it.
    const body = sentBody(fetchMock);
    expect(body.messages[0].content).toContain("READING");
    expect(body.messages[0].content).toContain('"reading"');
  });

  it("never asks for a reading on a title-only capture, and ignores one if the model offers it anyway", async () => {
    const fetchMock = mockChat({
      reading: { claim: "Invented.", catch: "Also invented." },
      insights: [{ index: 0, headline: "First under psychology.", body: "Nothing near it yet." }],
    });

    const result = await polishInsights({
      style: "DIRECT",
      itemTitle: "TikTok - Make Your Day",
      contentText: "TikTok - Make Your Day",
      contentGrounding: "thin",
      drafts: [NOVELTY_DRAFT],
    });

    expect(result.reading).toBeNull();
    expect(result.insights[0].headline).toBe("First under psychology.");
    expect(sentBody(fetchMock).messages[0].content).not.toContain("READING");
  });

  it("a claim without a catch is a summary, not a reading", async () => {
    mockChat({ reading: { claim: "Mental training matters.", catch: "" }, insights: [] });
    const result = await polishInsights({
      style: "DIRECT",
      itemTitle: "t",
      contentText: "enough text to be partial grounding",
      contentGrounding: "partial",
      drafts: [NOVELTY_DRAFT],
    });
    expect(result.reading).toBeNull();
    // Drafts untouched when the model rewrote none of them.
    expect(result.insights[0]).toEqual(NOVELTY_DRAFT);
  });

  it("respects the model declining (reading: null) on thin-but-not-title-only material", async () => {
    mockChat({ reading: null, insights: [{ index: 0, headline: "Rewritten.", body: "Body." }] });
    const result = await polishInsights({
      style: "REFLECTIVE",
      itemTitle: "#lawofattraction #detachment #manifestation",
      contentText: "#lawofattraction #detachment #manifestation",
      contentGrounding: "partial",
      drafts: [NOVELTY_DRAFT],
    });
    expect(result.reading).toBeNull();
    expect(result.insights[0].headline).toBe("Rewritten.");
  });

  it("shows the model enough of a transcript to find its claim", async () => {
    const fetchMock = mockChat({ reading: null, insights: [] });
    await polishInsights({
      style: "DIRECT",
      itemTitle: "t",
      contentText: "x".repeat(10_000),
      contentGrounding: "rich",
      drafts: [NOVELTY_DRAFT],
    });
    const user = JSON.parse(sentBody(fetchMock).messages[1].content) as { content_text: string };
    expect(user.content_text).toHaveLength(3000);
  });

  it("tells the polish that NOVELTY is a footnote that never promises", async () => {
    const fetchMock = mockChat({ reading: null, insights: [] });
    await polishInsights({ style: "DIRECT", itemTitle: "t", contentGrounding: "rich", drafts: [NOVELTY_DRAFT] });
    expect(sentBody(fetchMock).messages[0].content).toMatch(/NOVELTY drafts:.*never promise/i);
  });
});

describe("generateMirror", () => {
  const captures = [
    { title: "mental training is important!!", gist: "Rehearse under pressure.", topics: ["psychology"] },
    { title: "#lawofattraction #detachment #manifestation", gist: null, topics: ["law of attraction"] },
    { title: 'Comment "SAT" for more info', gist: "A study routine for the SAT.", topics: ["education"] },
  ];

  it("returns the read as the headline and the evidence as the body", async () => {
    const fetchMock = mockChat({
      read: "You're not collecting information, you're collecting techniques for controlling your own mind.",
      because: "Mental training, the law of attraction and an SAT routine are all methods for making yourself do what you already know you should.",
    });

    const mirror = await generateMirror({ style: "DIRECT", captures });

    expect(mirror).toEqual({
      headline: "You're not collecting information, you're collecting techniques for controlling your own mind.",
      body: "Mental training, the law of attraction and an SAT routine are all methods for making yourself do what you already know you should.",
    });
    const body = sentBody(fetchMock);
    expect(body.messages[0].content).toContain("exactly 3 things");
    const user = JSON.parse(body.messages[1].content) as { captures: { title: string; gist: string }[] };
    expect(user.captures).toHaveLength(3);
    expect(user.captures[1].gist).toBe("");
  });

  it("returns null when the model declines", async () => {
    mockChat({ read: null });
    expect(await generateMirror({ style: "DIRECT", captures })).toBeNull();
  });

  it("returns null without evidence — a read with nothing behind it is a horoscope", async () => {
    mockChat({ read: "You collect control.", because: "" });
    expect(await generateMirror({ style: "DIRECT", captures })).toBeNull();
  });

  it("returns null on API failure and on an empty subject list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as Response));
    expect(await generateMirror({ style: "DIRECT", captures })).toBeNull();
    const fetchMock = mockChat({ read: "x", because: "y" });
    expect(await generateMirror({ style: "DIRECT", captures: [] })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
