import { InsightType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { draftInsights, NOVELTY_STRENGTH, recentInsightContext, recentReadingContext, sortInsights } from "./insights";

/** The old NOVELTY bodies narrated the app's own emptiness and promised value
 * later. None of that language may come back. */
const PROMISE = /save (a few )?more|as you add more|patterns will|will start to (emerge|show)|the system will/i;

describe("draftInsights — NOVELTY is a footnote", () => {
  it("first capture: one short line at footnote strength, no promise of future value", () => {
    const drafts = draftInsights({
      style: "DIRECT",
      itemTitle: "Mental training for public speaking",
      topicNames: ["psychology"],
      topNeighbors: [],
      topicCounts: [{ topicId: "t1", name: "psychology", count: 1 }],
      shift: null,
      isFirstCapture: true,
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe(InsightType.NOVELTY);
    expect(drafts[0].strength).toBe(NOVELTY_STRENGTH);
    expect(drafts[0].body).not.toMatch(PROMISE);
    expect(drafts[0].body.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
  });

  it("a later capture that matches nothing gets the same footnote, never a promise", () => {
    for (const style of ["DIRECT", "REFLECTIVE", "ANALYTICAL"] as const) {
      const drafts = draftInsights({
        style,
        itemTitle: "Comment SAT for more info",
        topicNames: ["education"],
        topNeighbors: [],
        topicCounts: [{ topicId: "t2", name: "education", count: 1 }],
        shift: null,
        isFirstCapture: false,
      });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].type).toBe(InsightType.NOVELTY);
      expect(drafts[0].strength).toBe(NOVELTY_STRENGTH);
      expect(drafts[0].body).not.toMatch(PROMISE);
    }
  });

  it("the footnote sits below every graph reading's floor", () => {
    // Every real signal is drafted at >= 0.5 (the weakest is CONTRADICTS at
    // 0.5 + jaccard/2), so a footnote at NOVELTY_STRENGTH can never outrank one
    // on the archive's strongest-first lead insight.
    expect(NOVELTY_STRENGTH).toBeLessThan(0.5);
  });
});

describe("recentReadingContext", () => {
  it("hands back each reading's move and the opening words of its note, in order", () => {
    const rows = [
      {
        body: "If that were true, the tenth rehearsal would be calmer than the first for everyone.",
        evidence: { grounding: "rich", kicker: "the test" },
      },
      // Unlabelled move: the opening still counts as a shape not to reuse.
      { body: "Stoic ethics emphasizes inner judgment.", evidence: { grounding: "partial" } },
      { body: "", evidence: null },
    ];
    expect(recentReadingContext(rows)).toEqual([
      { move: "the test", opened_with: "If that were true, the tenth rehearsal would" },
      { opened_with: "Stoic ethics emphasizes inner judgment." },
      { opened_with: "" },
    ]);
  });
});

describe("sortInsights", () => {
  const rows = [
    { id: "novelty", type: InsightType.NOVELTY, strength: NOVELTY_STRENGTH, createdAt: new Date(1) },
    { id: "connection", type: InsightType.CONNECTION, strength: 0.7, createdAt: new Date(2) },
    { id: "reading", type: InsightType.READING, strength: 1, createdAt: new Date(5000) },
    { id: "mirror", type: InsightType.MIRROR, strength: 1, createdAt: new Date(6000) },
    { id: "pattern", type: InsightType.PATTERN, strength: 0.7, createdAt: new Date(1) },
  ];

  it("leads with the mirror, then the reading, then the graph readings by strength then age", () => {
    // READING and MIRROR are written seconds after the drafts, so createdAt
    // order would bury them under the footnote.
    expect(sortInsights(rows).map((r) => r.id)).toEqual([
      "mirror",
      "reading",
      "pattern",
      "connection",
      "novelty",
    ]);
  });

  it("returns a new array and leaves the input alone", () => {
    const before = rows.map((r) => r.id);
    const sorted = sortInsights(rows);
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("draftInsights — the thin fallback", () => {
  const thin = (extra: Partial<Parameters<typeof draftInsights>[0]> = {}) =>
    draftInsights({
      style: "DIRECT",
      itemTitle: "Sinners (2025)",
      topicNames: [],
      topNeighbors: [],
      topicCounts: [],
      shift: null,
      isFirstCapture: false,
      contentThin: true,
      ...extra,
    });

  it("blames the page when there was a page", () => {
    const [draft] = thin();
    expect(draft.headline).toBe("This source couldn't be read.");
    expect(draft.body).toContain("paywall");
  });

  // A diary entry has no page to fail on — saying the extraction failed
  // describes a fetch that never happened.
  it("says it couldn't place the work when the capture is a logged film or book", () => {
    const [draft] = thin({ workKind: "film" });
    expect(draft.headline).toBe("This film couldn't be placed.");
    expect(draft.body).toContain("Sinners (2025)");
    expect(draft.body).not.toContain("paywall");
    expect(draft.evidence).toEqual({ contentThin: true });
  });
});

describe("draftInsights — a CONNECTION names saves no other draft covers", () => {
  const neighbor = (id: string, title: string, edgeType: "REINFORCES" | "RELATED" | "RECURS", similarity: number) => ({
    capturedItemId: id,
    title,
    similarity,
    topicJaccard: 0.2,
    edgeType,
    capturedAt: new Date("2026-10-01"),
  });
  const base = {
    style: "DIRECT" as const,
    itemTitle: "Deep Work",
    topicNames: ["work habits"],
    topicCounts: [{ topicId: "t1", name: "work habits", count: 2 }],
    shift: null,
    isFirstCapture: false,
  };

  it("skips the CONNECTION when the only neighbour is the one REINFORCES already named", () => {
    const drafts = draftInsights({ ...base, topNeighbors: [neighbor("a", "The Acceleration of Addictiveness", "REINFORCES", 0.62)] });
    expect(drafts.map((d) => d.type)).toEqual([InsightType.REINFORCES]);
  });

  it("names only the uncovered neighbours, so two drafts are never about the same save", () => {
    const drafts = draftInsights({
      ...base,
      topNeighbors: [
        neighbor("a", "The Acceleration of Addictiveness", "REINFORCES", 0.62),
        neighbor("b", "Thinking, Fast and Slow", "RELATED", 0.4),
        neighbor("c", "The Scout Mindset", "RELATED", 0.35),
      ],
    });
    const connection = drafts.find((d) => d.type === InsightType.CONNECTION);
    expect(connection?.headline).toContain("Thinking, Fast and Slow");
    expect(connection?.headline).not.toContain("Addictiveness");
    const named = (connection?.evidence as { neighbors: { capturedItemId: string }[] }).neighbors.map((n) => n.capturedItemId);
    expect(named).toEqual(["b", "c"]);
  });

  it("draft bodies are the bare fact, not the old three-sentence sermon", () => {
    const drafts = draftInsights({ ...base, topNeighbors: [neighbor("a", "The Acceleration of Addictiveness", "RECURS", 0.7)] });
    expect(drafts[0].body.split(/[.!?]\s/).length).toBeLessThanOrEqual(1);
    expect(drafts[0].body).not.toMatch(/worth asking|unresolved question|echo/i);
  });
});

describe("recentInsightContext", () => {
  it("takes the opening from the headline with the named saves stripped, so two hinges on different titles read as one", () => {
    const rows = [
      { headline: "If 'The State of the Culture, 2024' is right that distraction won, then 'Deep Work' is resistance.", evidence: { kicker: "what follows" } },
      { headline: 'If "Arrival" is right that language reshapes perception, then Whiplash shows discipline reshaping identity.', evidence: { kicker: "what follows" } },
      { headline: "Because Whiplash shows ambition turning into self-destruction, it explains Great Work's insistence on interest.", evidence: {} },
    ];
    const context = recentInsightContext(rows);
    expect(context[0]).toEqual({ move: "what follows", opened_with: "If is right that" });
    expect(context[1].opened_with).toBe(context[0].opened_with);
    expect(context[2]).toEqual({ opened_with: "Because Whiplash shows ambition" });
  });
});
