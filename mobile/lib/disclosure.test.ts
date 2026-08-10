import { describe, expect, it } from "vitest";
import {
  ARCHIVE_REVEAL_COUNT,
  computeTabGlows,
  EVENT_FLAGS,
  glowSeenFlag,
  isAnonymousHandle,
  MAX_WHISPERS_PER_SESSION,
  pickNextWhisper,
  WHISPERS,
  YOU_REVEAL_COUNT,
  type WhisperId,
} from "./disclosure";

const seen = (...ids: string[]) => new Set(ids);

describe("pickNextWhisper", () => {
  it("returns null with no pending candidates", () => {
    expect(pickNextWhisper([], seen(), 0)).toBeNull();
  });

  it("picks the highest-priority (lowest number) candidate", () => {
    const pending: WhisperId[] = ["identity-claim", "clipboard-link", "share-extension"];
    expect(pickNextWhisper(pending, seen(), 0)).toBe("clipboard-link");
  });

  it("fires exactly once: a seen whisper is never picked again", () => {
    expect(pickNextWhisper(["clipboard-link"], seen("clipboard-link"), 0)).toBeNull();
  });

  it("falls through to the next priority when the top candidate was seen", () => {
    const pending: WhisperId[] = ["clipboard-link", "mind-first-edge"];
    expect(pickNextWhisper(pending, seen("clipboard-link"), 0)).toBe("mind-first-edge");
  });

  it("respects the per-session cap on both sides of the boundary", () => {
    expect(pickNextWhisper(["mind-first-edge"], seen(), MAX_WHISPERS_PER_SESSION - 1)).toBe(
      "mind-first-edge",
    );
    expect(pickNextWhisper(["mind-first-edge"], seen(), MAX_WHISPERS_PER_SESSION)).toBeNull();
  });

  it("ignores unknown ids so a stale persisted queue cannot crash arbitration", () => {
    const pending = ["retired-whisper", "mind-first-edge"] as unknown as WhisperId[];
    expect(pickNextWhisper(pending, seen(), 0)).toBe("mind-first-edge");
  });

  it("priorities are unique so arbitration is deterministic", () => {
    const priorities = Object.values(WHISPERS).map((w) => w.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});

describe("isAnonymousHandle", () => {
  it("matches only the server's generated shape", () => {
    expect(isAnonymousHandle("n_3f9ab210")).toBe(true);
    expect(isAnonymousHandle("n_3f9ab21")).toBe(false);
    expect(isAnonymousHandle("n_3F9AB210")).toBe(false);
    expect(isAnonymousHandle("nautilus1")).toBe(false);
    expect(isAnonymousHandle(null)).toBe(false);
    expect(isAnonymousHandle(undefined)).toBe(false);
  });
});

describe("computeTabGlows", () => {
  const quiet = { captureCount: 0, hasOwnEdge: false };

  it("nothing glows for a brand-new user", () => {
    expect(computeTabGlows(quiet, seen())).toEqual({
      mind: false,
      archive: false,
      you: false,
      pulse: false,
    });
  });

  it("mind glows on the first real edge, regardless of capture count", () => {
    expect(computeTabGlows({ captureCount: 2, hasOwnEdge: true }, seen()).mind).toBe(true);
  });

  it("archive glows at the reveal count, not before", () => {
    expect(
      computeTabGlows({ ...quiet, captureCount: ARCHIVE_REVEAL_COUNT - 1 }, seen()).archive,
    ).toBe(false);
    expect(computeTabGlows({ ...quiet, captureCount: ARCHIVE_REVEAL_COUNT }, seen()).archive).toBe(
      true,
    );
  });

  it("you glows at its reveal count, not before", () => {
    expect(computeTabGlows({ ...quiet, captureCount: YOU_REVEAL_COUNT - 1 }, seen()).you).toBe(
      false,
    );
    expect(computeTabGlows({ ...quiet, captureCount: YOU_REVEAL_COUNT }, seen()).you).toBe(true);
  });

  it("pulse reveals only from the shared-atlas event flag, never from counts", () => {
    expect(computeTabGlows({ captureCount: 100, hasOwnEdge: true }, seen()).pulse).toBe(false);
    expect(computeTabGlows(quiet, seen(EVENT_FLAGS.sharedAtlas)).pulse).toBe(true);
  });

  it("visiting a glowing tab retires that glow forever without touching others", () => {
    const signals = { captureCount: ARCHIVE_REVEAL_COUNT, hasOwnEdge: true };
    const glows = computeTabGlows(signals, seen(glowSeenFlag("mind")));
    expect(glows.mind).toBe(false);
    expect(glows.archive).toBe(true);
  });
});
