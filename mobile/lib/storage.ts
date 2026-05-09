import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'noetic_auth_token';
const USER_ID_KEY = 'noetic_user_id';

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

export async function clearAuth(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
  ]);
}
