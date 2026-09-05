// When to put the notifications card in front of someone.
//
// The old rule was "ask once, ever", on the belief that our own card spent the
// install's single iOS prompt. It does not: iOS only counts the system prompt,
// and that is shown only when the user taps "turn on". A "not now" on our card
// costs nothing, so it can be offered again later. What must never happen is
// asking after the system prompt has been spent — that produces a card with no
// prompt behind it.
//
// Pure module, no imports: it runs under the backend vitest target alongside
// the other mobile/lib policy files.

export type PushAskState = {
  /** Times the card was dismissed with "not now". */
  declines: number;
  /** When the last dismissal happened, epoch ms. */
  lastDeclineAt: number | null;
  /** The system prompt has been shown. Nothing we do can show it again. */
  spent: boolean;
};

export const INITIAL_PUSH_ASK: PushAskState = { declines: 0, lastDeclineAt: null, spent: false };

/** After this many "not now"s the answer is taken as final. */
export const PUSH_ASK_MAX_DECLINES = 3;
/** How long a "not now" holds before the card may come back. */
export const PUSH_ASK_RETRY_MS = 3 * 24 * 60 * 60 * 1000;

/** Whether the card may be shown now. */
export function pushAskDue(state: PushAskState, now: number): boolean {
  if (state.spent) return false;
  if (state.declines >= PUSH_ASK_MAX_DECLINES) return false;
  if (state.declines === 0 || state.lastDeclineAt === null) return true;
  return now - state.lastDeclineAt >= PUSH_ASK_RETRY_MS;
}

/** Whether the person has ever been asked, in-app or by the system. */
export function pushEverAsked(state: PushAskState): boolean {
  return state.spent || state.declines > 0;
}

export function declinePushAsk(state: PushAskState, now: number): PushAskState {
  return { ...state, declines: state.declines + 1, lastDeclineAt: now };
}

export function spendPushAsk(state: PushAskState): PushAskState {
  return { ...state, spent: true };
}

/** Parse a stored state, tolerating anything that is not one. */
export function parsePushAskState(raw: string | null | undefined): PushAskState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PushAskState>;
    if (typeof value !== 'object' || value === null) return null;
    const declines = typeof value.declines === 'number' && value.declines >= 0 ? Math.floor(value.declines) : 0;
    const lastDeclineAt = typeof value.lastDeclineAt === 'number' ? value.lastDeclineAt : null;
    return { declines, lastDeclineAt, spent: value.spent === true };
  } catch {
    return null;
  }
}
