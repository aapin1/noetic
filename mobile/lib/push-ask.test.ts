import { describe, expect, it } from "vitest";
import {
  declinePushAsk,
  INITIAL_PUSH_ASK,
  parsePushAskState,
  PUSH_ASK_MAX_DECLINES,
  PUSH_ASK_RETRY_MS,
  pushAskDue,
  pushEverAsked,
  spendPushAsk,
} from "./push-ask";

const T0 = 1_700_000_000_000;

describe("pushAskDue", () => {
  it("asks a fresh install", () => {
    expect(pushAskDue(INITIAL_PUSH_ASK, T0)).toBe(true);
  });

  it("holds after a decline, then comes back once the retry window passes", () => {
    const declined = declinePushAsk(INITIAL_PUSH_ASK, T0);
    expect(pushAskDue(declined, T0)).toBe(false);
    expect(pushAskDue(declined, T0 + PUSH_ASK_RETRY_MS - 1)).toBe(false);
    expect(pushAskDue(declined, T0 + PUSH_ASK_RETRY_MS)).toBe(true);
  });

  it("takes repeated declines as final", () => {
    let state = INITIAL_PUSH_ASK;
    for (let i = 0; i < PUSH_ASK_MAX_DECLINES; i += 1) state = declinePushAsk(state, T0 + i);
    expect(pushAskDue(state, T0 + 10 * PUSH_ASK_RETRY_MS)).toBe(false);
  });

  it("never asks again once the system prompt has been shown", () => {
    expect(pushAskDue(spendPushAsk(INITIAL_PUSH_ASK), T0 + 10 * PUSH_ASK_RETRY_MS)).toBe(false);
  });

  it("treats a legacy 'asked' flag as one old decline, so the card returns once", () => {
    // How storage.ts maps the old boolean: one decline, long ago.
    const legacy = { declines: 1, lastDeclineAt: 0, spent: false };
    expect(pushAskDue(legacy, T0)).toBe(true);
    expect(pushEverAsked(legacy)).toBe(true);
  });
});

describe("parsePushAskState", () => {
  it("round-trips and rejects junk", () => {
    const state = declinePushAsk(INITIAL_PUSH_ASK, T0);
    expect(parsePushAskState(JSON.stringify(state))).toEqual(state);
    expect(parsePushAskState("not json")).toBeNull();
    expect(parsePushAskState("")).toBeNull();
    expect(parsePushAskState(null)).toBeNull();
    expect(parsePushAskState('{"declines":"x","spent":"yes"}')).toEqual({ declines: 0, lastDeclineAt: null, spent: false });
  });
});
