import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'mneme_auth_token';
const USER_ID_KEY = 'mneme_user_id';
/** Set once the pre-permission sheet has been shown, so we ask exactly once. */
const PUSH_ASKED_KEY = 'mneme_push_asked';

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
 * Whether we've already put the push pre-permission sheet in front of this
 * person. iOS only ever shows the real system prompt once per install, so a
 * second ask is not a second chance — it's a silent no. One ask, ever.
 */
export async function hasAskedForPush(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PUSH_ASKED_KEY)) === '1';
}

export async function markAskedForPush(): Promise<void> {
  await SecureStore.setItemAsync(PUSH_ASKED_KEY, '1');
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
