// The first-session ritual: over the ghost map, one soft prompt — "what's
// been on your mind lately?" — then, gently, "what else?", chaining only
// until the first real edge draws between the user's own thoughts. The ritual
// ends at the aha; it never milks. Skipping is guilt-free at every beat.
//
// Pure state machine, no imports — testable under the backend vitest target.
// All I/O (capture API, graph refetch, persistence) lives in the component.

export const RITUAL_MAX_FRAGMENTS = 3;

export type RitualEndReason = "edge" | "skipped" | "cap";

export type RitualState = {
  step: "prompt" | "waiting" | "done";
  /** Capture ids of the fragments landed so far, in order. */
  fragments: string[];
  endReason: RitualEndReason | null;
};

export type RitualEvent =
  | { type: "SUBMIT" }
  | { type: "CAPTURED"; id: string }
  | { type: "CAPTURE_FAILED" }
  | { type: "EDGE_FOUND" }
  | { type: "SKIP" };

export function ritualInitial(): RitualState {
  return { step: "prompt", fragments: [], endReason: null };
}

export function ritualReduce(state: RitualState, event: RitualEvent): RitualState {
  if (state.step === "done") {
    return state;
  }

  switch (event.type) {
    case "SKIP":
      return { ...state, step: "done", endReason: "skipped" };

    case "SUBMIT":
      return state.step === "prompt" ? { ...state, step: "waiting" } : state;

    case "CAPTURE_FAILED":
      return state.step === "waiting" ? { ...state, step: "prompt" } : state;

    case "CAPTURED": {
      // Accepted from "waiting" (this ritual's own submit resolving) AND from
      // "prompt": a capture made through the ordinary composer while the
      // ritual is up counts as a fragment — the prompt is an invitation, not
      // the only door.
      if (state.fragments.includes(event.id)) {
        return state;
      }
      const fragments = [...state.fragments, event.id];
      // The cap is a hard stop even when no edge ever draws — three asks is
      // the most this ritual is allowed to want.
      if (fragments.length >= RITUAL_MAX_FRAGMENTS) {
        return { step: "done", fragments, endReason: "cap" };
      }
      return { ...state, step: "prompt", fragments };
    }

    case "EDGE_FOUND":
      // The aha needs two of THEIR OWN thoughts on the map — an edge signal
      // before that is noise (or a race) and must not end the ritual early.
      if (state.fragments.length < 2) {
        return state;
      }
      return { ...state, step: "done", endReason: "edge" };
  }
}

/** The prompt never asks twice with the same words. */
export function ritualPrompt(state: RitualState): string {
  return state.fragments.length === 0 ? "what's been on your mind lately?" : "what else?";
}

/**
 * Whether any edge connects two ritual fragments — the moment the ritual
 * exists to produce. Edges to older corpus don't count (there is no older
 * corpus in a true first session, but a re-armed ritual must not claim one).
 */
export function hasOwnEdge(
  fragmentIds: readonly string[],
  edges: readonly { fromItemId: string; toItemId: string }[],
): boolean {
  if (fragmentIds.length < 2) return false;
  const ids = new Set(fragmentIds);
  return edges.some((e) => ids.has(e.fromItemId) && ids.has(e.toItemId));
}
