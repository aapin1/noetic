import { describe, expect, it } from "vitest";
import {
  GUIDE_STEPS,
  guideAckFlag,
  nextGuideStep,
  type GuideSignals,
} from "./guide";

const quiet: GuideSignals = {
  captureCount: 0,
  openedNode: false,
  visitedMind: false,
  visitedArchive: false,
  visitedImport: false,
  openedCompanion: false,
};

const seen = (...flags: string[]) => {
  const set = new Set(flags);
  return (flag: string) => set.has(flag);
};

describe("nextGuideStep", () => {
  it("starts a brand-new user at the first-capture offer", () => {
    expect(nextGuideStep(quiet, seen())?.id).toBe("first-capture");
  });

  it("advances by what the user actually did, not by what was shown", () => {
    // Captured once (through ANY door) — the guide moves on without an ack.
    expect(nextGuideStep({ ...quiet, captureCount: 1 }, seen())?.id).toBe("open-node");
    // Opened the node too — next lesson.
    expect(nextGuideStep({ ...quiet, captureCount: 1, openedNode: true }, seen())?.id).toBe(
      "second-thought",
    );
  });

  it("skipping a step retires it without blocking the rest", () => {
    const step = nextGuideStep(quiet, seen(guideAckFlag("first-capture")));
    expect(step?.id).toBe("open-node");
  });

  it("catches up a user who did several things on their own", () => {
    const signals: GuideSignals = {
      captureCount: 3,
      openedNode: true,
      visitedMind: true,
      visitedArchive: true,
      visitedImport: false,
      openedCompanion: false,
    };
    expect(nextGuideStep(signals, seen())?.id).toBe("share-anywhere");
  });

  it("acknowledge-only steps never complete via signals", () => {
    const everything: GuideSignals = {
      captureCount: 99,
      openedNode: true,
      visitedMind: true,
      visitedArchive: true,
      visitedImport: true,
      openedCompanion: true,
    };
    expect(nextGuideStep(everything, seen())?.id).toBe("share-anywhere");
  });

  it("returns null — guide done — once every step is done or waved off", () => {
    const everything: GuideSignals = {
      captureCount: 2,
      openedNode: true,
      visitedMind: true,
      visitedArchive: true,
      visitedImport: true,
      openedCompanion: true,
    };
    const acks = GUIDE_STEPS.filter((s) => s.kind === "ack").map((s) => guideAckFlag(s.id));
    expect(nextGuideStep(everything, seen(...acks))).toBeNull();
  });

  it("every pill line stays pill-sized and lowercase", () => {
    for (const step of GUIDE_STEPS) {
      expect(step.line.length).toBeLessThanOrEqual(48);
      expect(step.line).toBe(step.line.toLowerCase());
      expect(step.line).not.toContain("!");
    }
  });

  it("ack steps always carry a cta so ✕ is never the only exit", () => {
    for (const step of GUIDE_STEPS) {
      if (step.kind === "ack") expect(step.cta).not.toBeNull();
    }
  });
});
