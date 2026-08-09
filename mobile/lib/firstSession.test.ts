import { describe, expect, it } from "vitest";
import {
  hasOwnEdge,
  RITUAL_MAX_FRAGMENTS,
  ritualInitial,
  ritualPrompt,
  ritualReduce,
  type RitualEvent,
  type RitualState,
} from "./firstSession";

const run = (events: RitualEvent[], from: RitualState = ritualInitial()) =>
  events.reduce(ritualReduce, from);

describe("ritualReduce", () => {
  it("starts at the first prompt with nothing landed", () => {
    const s = ritualInitial();
    expect(s.step).toBe("prompt");
    expect(s.fragments).toEqual([]);
    expect(ritualPrompt(s)).toBe("what's been on your mind lately?");
  });

  it("submit → waiting → captured returns to a gentler prompt", () => {
    const s = run([{ type: "SUBMIT" }, { type: "CAPTURED", id: "c1" }]);
    expect(s.step).toBe("prompt");
    expect(s.fragments).toEqual(["c1"]);
    expect(ritualPrompt(s)).toBe("what else?");
  });

  it("a failed capture returns to the prompt without recording a fragment", () => {
    const s = run([{ type: "SUBMIT" }, { type: "CAPTURE_FAILED" }]);
    expect(s.step).toBe("prompt");
    expect(s.fragments).toEqual([]);
  });

  it("the edge between their own thoughts ends the ritual at the aha", () => {
    const s = run([
      { type: "SUBMIT" },
      { type: "CAPTURED", id: "c1" },
      { type: "SUBMIT" },
      { type: "CAPTURED", id: "c2" },
      { type: "EDGE_FOUND" },
    ]);
    expect(s.step).toBe("done");
    expect(s.endReason).toBe("edge");
    expect(s.fragments).toEqual(["c1", "c2"]);
  });

  it("never claims the aha before two of their own thoughts exist", () => {
    const s = run([{ type: "SUBMIT" }, { type: "CAPTURED", id: "c1" }, { type: "EDGE_FOUND" }]);
    expect(s.step).toBe("prompt");
    expect(s.endReason).toBeNull();
  });

  it("stops at the fragment cap even with no edge — it never milks", () => {
    const events: RitualEvent[] = [];
    for (let i = 0; i < RITUAL_MAX_FRAGMENTS; i++) {
      events.push({ type: "SUBMIT" }, { type: "CAPTURED", id: `c${i}` });
    }
    const s = run(events);
    expect(s.step).toBe("done");
    expect(s.endReason).toBe("cap");
    expect(s.fragments).toHaveLength(RITUAL_MAX_FRAGMENTS);
  });

  it("skip is honored at every beat", () => {
    expect(run([{ type: "SKIP" }]).endReason).toBe("skipped");
    expect(run([{ type: "SUBMIT" }, { type: "SKIP" }]).endReason).toBe("skipped");
    expect(
      run([{ type: "SUBMIT" }, { type: "CAPTURED", id: "c1" }, { type: "SKIP" }]).endReason,
    ).toBe("skipped");
  });

  it("done is terminal — no event reopens the ritual", () => {
    const done = run([{ type: "SKIP" }]);
    for (const event of [
      { type: "SUBMIT" },
      { type: "CAPTURED", id: "cx" },
      { type: "EDGE_FOUND" },
      { type: "SKIP" },
      { type: "CAPTURE_FAILED" },
    ] as RitualEvent[]) {
      expect(ritualReduce(done, event)).toBe(done);
    }
  });

  it("a duplicate capture id (retry race) is not counted twice", () => {
    const s = run([
      { type: "SUBMIT" },
      { type: "CAPTURED", id: "c1" },
      { type: "SUBMIT" },
      { type: "CAPTURED", id: "c1" },
    ]);
    expect(s.fragments).toEqual(["c1"]);
  });
});

describe("hasOwnEdge", () => {
  const edge = (a: string, b: string) => ({ fromItemId: a, toItemId: b });

  it("finds an edge between two fragments regardless of direction", () => {
    expect(hasOwnEdge(["c1", "c2"], [edge("c2", "c1")])).toBe(true);
    expect(hasOwnEdge(["c1", "c2"], [edge("c1", "c2")])).toBe(true);
  });

  it("an edge to the wider corpus is not the aha", () => {
    expect(hasOwnEdge(["c1", "c2"], [edge("c1", "old-node")])).toBe(false);
  });

  it("needs at least two fragments", () => {
    expect(hasOwnEdge(["c1"], [edge("c1", "c1")])).toBe(false);
    expect(hasOwnEdge([], [])).toBe(false);
  });
});
