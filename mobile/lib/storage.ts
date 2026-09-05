import * as SecureStore from 'expo-secure-store';
import {
  declinePushAsk,
  INITIAL_PUSH_ASK,
  parsePushAskState,
  pushAskDue,
  pushEverAsked,
  spendPushAsk,
  type PushAskState,
} from './push-ask';

const TOKEN_KEY = 'mneme_auth_token';
const USER_ID_KEY = 'mneme_user_id';
/** Legacy boolean flag; read once for migration, never written again. */
const PUSH_ASKED_KEY = 'mneme_push_asked';
const PUSH_ASK_KEY = 'mneme_push_ask';

/** SecureStore only accepts strings; coerce and validate so callers never hit opaque native errors. */
function asSecureString(label: string, value: unknown): string {
  if (value == null) {
    throw new Error(`${label} is missing`);
  }
  const s = typeof value === 'string' ? value : String(value);
  if (!s) {
    throw new Error(`${label} is empty`);
  }
  return s;
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, asSecureString('Auth token', token));
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function removeToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function storeUserId(userId: string): Promise<void> {
  await SecureStore.setItemAsync(USER_ID_KEY, asSecureString('User id', userId));
}

export async function getUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_ID_KEY);
}

/**
 * The notifications ask, as durable state: how many times the card was
 * dismissed, when, and whether the iOS prompt has been spent. Kept in the
 * Keychain like the rest of this file, so it survives reinstall — a spent
 * prompt must never be offered again, whatever happens to the app bundle.
 *
 * The old key held a bare "asked" flag that treated "not now" as final. It is
 * read as one decline long ago, so those installs get the card exactly once
 * more (unless permission is already on, in which case the provider marks the
 * ask spent at launch and nothing shows).
 */
export async function getPushAskState(): Promise<PushAskState> {
  try {
    const parsed = parsePushAskState(await SecureStore.getItemAsync(PUSH_ASK_KEY));
    if (parsed) return parsed;
    if ((await SecureStore.getItemAsync(PUSH_ASKED_KEY)) === '1') {
      return { declines: 1, lastDeclineAt: 0, spent: false };
    }
  } catch {
    // Unreadable is the same as never asked.
  }
  return INITIAL_PUSH_ASK;
}

async function setPushAskState(state: PushAskState): Promise<void> {
  await SecureStore.setItemAsync(PUSH_ASK_KEY, JSON.stringify(state));
}

/** Whether the card may be shown now. */
export async function shouldOfferPush(): Promise<boolean> {
  return pushAskDue(await getPushAskState(), Date.now());
}

/** Whether the person has ever been asked, by our card or by the system. */
export async function hasAskedForPush(): Promise<boolean> {
  return pushEverAsked(await getPushAskState());
}

/** "Not now" on the card. The card may come back after PUSH_ASK_RETRY_MS. */
export async function recordPushDeclined(): Promise<void> {
  await setPushAskState(declinePushAsk(await getPushAskState(), Date.now()));
}

/** The system prompt has been shown (or permission is already on). Final. */
export async function markPushPromptSpent(): Promise<void> {
  const state = await getPushAskState();
  if (!state.spent) await setPushAskState(spendPushAsk(state));
}

export async function clearAuth(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
  ]);
  // Deliberately NOT clearing PUSH_ASKED_KEY: the OS-level permission decision
  // survives sign-out too, so re-asking the next account on this device would
  // show a sheet that can no longer produce a system prompt.
}
