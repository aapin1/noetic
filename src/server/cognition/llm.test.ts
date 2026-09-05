import { InsightType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightDraft } from "./insights";
import { chooseReadingNote, generateMirror, identifyWork, polishInsights } from "./llm";

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
  it("returns the model's line and its picked note as a READING draft, with the move in evidence", async () => {
    const fetchMock = mockChat({
      reading: {
        line: "Public speaking nerves are a training problem, not a personality trait.",
        options: [
          { move: "the catch", note: "Exposure works on fear of the stage, not on having nothing to say." },
          {
            move: "The Test.",
            note: "If that were true, the tenth rehearsal would be calmer than the first for everyone, and for a lot of people it isn't.",
          },
          { move: "the number", note: "Beta blockers cut performance anxiety in about 70% of musicians in the 1980s trials." },
        ],
        pick: 1,
      },
      insights: [{ index: 0, headline: "First under psychology.", body: "Nothing near it yet." }],
    });

    const result = await polishInsights({
      style: "DIRECT",
      itemTitle: "mental training is important!!",
      contentText: "A transcript about rehearsing under pressure so the stage feels familiar.",
      contentGrounding: "rich",
      recentReadings: [
        { move: "the catch", opened_with: "Environment design is itself an act of" },
        { move: "the catch", opened_with: "Decoherence describes the appearance of collapse but" },
      ],
      drafts: [NOVELTY_DRAFT],
    });

    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].headline).toBe("First under psychology.");
    expect(result.reading).toMatchObject({
      type: InsightType.READING,
      headline: "Public speaking nerves are a training problem, not a personality trait.",
      body: "If that were true, the tenth rehearsal would be calmer than the first for everyone, and for a lot of people it isn't.",
      strength: 1,
      // Normalised: lowercase, trailing punctuation dropped.
      evidence: { grounding: "rich", kicker: "the test" },
    });
    // The contract is in the prompt, the output shape asks for it, and the
    // user's recent moves are handed over so the next reading differs.
    const body = sentBody(fetchMock);
    expect(body.messages[0].content).toContain("READING");
    expect(body.messages[0].content).toContain('"reading"');
    expect(body.messages[0].content).toMatch(/move of your own/i);
    // The contract's core test, and the anti-routing rule, are in the prompt.
    expect(body.messages[0].content).toMatch(/OUTSIDE the content/);
    expect(body.messages[0].content).toMatch(/never by the content's genre/);
    const user = JSON.parse(body.messages[1].content) as {
      recent_readings: { move?: string; opened_with: string }[];
    };
    expect(user.recent_readings).toEqual([
      { move: "the catch", opened_with: "Environment design is itself an act of" },
      { move: "the catch", opened_with: "Decoherence describes the appearance of collapse but" },
    ]);
  });

  it("never asks for a reading on a title-only capture, and ignores one if the model offers it anyway", async () => {
    const fetchMock = mockChat({
      reading: { line: "Invented.", options: [{ move: "the catch", note: "Also invented." }], pick: 0 },
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

  it("a line without a note is a summary, not a reading", async () => {
    mockChat({ reading: { line: "Mental training matters.", options: [{ move: "the catch", note: "" }], pick: 0 }, insights: [] });
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

  it("keeps a reading whose move went unnamed, just without a label", async () => {
    mockChat({ reading: { line: "A line.", options: [{ note: "A note on it." }], pick: 0 }, insights: [] });
    const result = await polishInsights({ style: "DIRECT", itemTitle: "t", contentGrounding: "rich", drafts: [NOVELTY_DRAFT] });
    expect(result.reading?.headline).toBe("A line.");
    expect(result.reading?.body).toBe("A note on it.");
    expect(result.reading?.evidence).toEqual({ grounding: "rich" });
  });

  it("overrides the model's pick when it repeats a move the user was just given", async () => {
    mockChat({
      reading: {
        line: "A line.",
        options: [
          { move: "the catch", note: "Catch note." },
          { move: "the mechanism", note: "Mechanism note." },
          { move: "the number", note: "Number note." },
        ],
        pick: 1,
      },
      insights: [],
    });
    const result = await polishInsights({
      style: "DIRECT",
      itemTitle: "t",
      contentGrounding: "rich",
      recentReadings: [{ move: "the mechanism", opened_with: "x" }, { move: "the catch", opened_with: "y" }],
      drafts: [NOVELTY_DRAFT],
    });
    // The pick (mechanism) and the first option (catch) are both recent; the
    // number is the first fresh move.
    expect(result.reading?.body).toBe("Number note.");
    expect(result.reading?.evidence).toEqual({ grounding: "rich", kicker: "the number" });
  });

  it("tells the polish that NOVELTY is a footnote that never promises", async () => {
    const fetchMock = mockChat({ reading: null, insights: [] });
    await polishInsights({ style: "DIRECT", itemTitle: "t", contentGrounding: "rich", drafts: [NOVELTY_DRAFT] });
    expect(sentBody(fetchMock).messages[0].content).toMatch(/NOVELTY drafts:.*never promise/i);
  });
});

describe("chooseReadingNote", () => {
  const options = [
    { move: "The Catch", note: "a" },
    { move: "the test", note: "b" },
    { move: "the cost", note: "c" },
  ];

  it("honours the pick when its move is fresh, normalising the move name", () => {
    expect(chooseReadingNote(options, 0, [])).toEqual({ move: "the catch", note: "a" });
    expect(chooseReadingNote(options, 2, [{ move: "the catch" }])).toEqual({ move: "the cost", note: "c" });
  });

  it("falls back to the first option on a missing or out-of-range pick", () => {
    expect(chooseReadingNote(options, undefined, [])).toEqual({ move: "the catch", note: "a" });
    expect(chooseReadingNote(options, 7, [])).toEqual({ move: "the catch", note: "a" });
  });

  it("keeps the pick when every option repeats a recent move — repetition beats silence", () => {
    const recent = [{ move: "the catch" }, { move: "the test" }, { move: "the cost" }];
    expect(chooseReadingNote(options, 1, recent)).toEqual({ move: "the test", note: "b" });
  });

  it("drops empty notes and returns null with nothing usable", () => {
    expect(chooseReadingNote([{ move: "the catch", note: " " }], 0, [])).toBeNull();
    expect(chooseReadingNote(undefined, 0, [])).toBeNull();
    expect(chooseReadingNote("nope", 0, [])).toBeNull();
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
    // No shape example to copy, and the construction it kept copying is out.
    expect(body.messages[0].content).toMatch(/no template/i);
    expect(body.messages[0].content).not.toMatch(/techniques for controlling your own mind/);
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

describe("identifyWork", () => {
  it("returns what the model says the work is, and shows it the title, year and author", async () => {
    const fetchMock = mockChat({
      known: true,
      description: "A 2025 horror film written and directed by Ryan Coogler, set in 1930s Mississippi.",
    });

    const description = await identifyWork({ kind: "film", title: "Sinners", year: 2025 });

    expect(description).toBe("A 2025 horror film written and directed by Ryan Coogler, set in 1930s Mississippi.");
    const sent = JSON.parse(sentBody(fetchMock).messages[1].content) as Record<string, unknown>;
    expect(sent).toMatchObject({ kind: "film", title: "Sinners", year: 2025 });
  });

  // The whole reason this call is safe to make: a blurb it isn't sure about
  // would be embedded, classified, and shown as the capture's About text.
  it("returns null when the model declines, even if it drafted a description anyway", async () => {
    mockChat({ known: false, description: "A film of some kind, probably." });
    expect(await identifyWork({ kind: "film", title: "Sinners", year: 2025 })).toBeNull();
  });

  it("returns null on an empty description, a failed request, and unparseable JSON", async () => {
    mockChat({ known: true, description: "   " });
    expect(await identifyWork({ kind: "book", title: "Ulysses" })).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false } as unknown as Response));
    expect(await identifyWork({ kind: "book", title: "Ulysses" })).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    } as unknown as Response));
    expect(await identifyWork({ kind: "book", title: "Ulysses" })).toBeNull();
  });

  it("makes no call without an api key", async () => {
    const fetchMock = mockChat({ known: true, description: "…" });
    delete process.env.OPENAI_API_KEY;
    expect(await identifyWork({ kind: "film", title: "Heat", year: 1995 })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
