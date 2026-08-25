import { InsightType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { draftInsights, NOVELTY_STRENGTH, sortInsights } from "./insights";

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
