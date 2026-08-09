import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { clearQueryCache } from '@/hooks/useApiQuery';
import { clearAuth, getToken, storeToken, storeUserId } from '@/lib/storage';
import { identifyUser, resetIdentity, track } from '@/lib/analytics';
import type { OwnerProfile } from '@/types/api';
import { DEV_FAKE_LOGIN } from '@/dev/fake-login';

interface AuthState {
  token: string | null;
  profile: OwnerProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasProfile: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (identifier: string, password: string) => Promise<void>;
  signInWithApple: (args: {
    identityToken: string;
    fullName?: string;
  }) => Promise<{ isNewUser: boolean; hasHandle: boolean }>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isDevFakeCredentials(identifier: string, password: string) {
  return (
    DEV_FAKE_LOGIN.enabled &&
    identifier.trim().toLowerCase() === DEV_FAKE_LOGIN.credentials.email.toLowerCase() &&
    password === DEV_FAKE_LOGIN.credentials.password
  );
}

function isDevFakeToken(token: string | null) {
  return DEV_FAKE_LOGIN.enabled && token === DEV_FAKE_LOGIN.token;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    profile: null,
    isLoading: true,
    isAuthenticated: false,
    hasProfile: false,
  });

  const loadProfile = useCallback(async () => {
    const token = await getToken();
    if (isDevFakeToken(token)) {
      setState((prev) => ({
        ...prev,
        profile: DEV_FAKE_LOGIN.profile,
        hasProfile: true,
        isLoading: false,
      }));
      return;
    }

    // A valid token can still hit a flaky profile fetch (network blip, 5xx,
    // cold serverless start). Retry transient failures instead of tearing down
    // the session — otherwise a just-issued, correct login gets silently undone.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await api.profile.me();
        // Every restored session re-identifies, which is also what backfills
        // `signup_date` for accounts that predate analytics — without it the
        // activation window has no anchor for the existing user base.
        identifyUser(result.profile.id, result.profile.createdAt ?? null);
        setState((prev) => ({
          ...prev,
          profile: result.profile,
          isAuthenticated: true,
          hasProfile: true,
          isLoading: false,
        }));
        return;
      } catch (error) {
        const code = (error as Error & { code?: string })?.code;

        // No profile means an account from the era when onboarding could be
        // abandoned between registration and the identity step (new accounts
        // get one server-side at creation). Self-heal: mint the anonymous
        // profile and retry, so these users land on the map like everyone
        // else instead of being parked behind a dead onboarding route.
        if (code === 'PROFILE_NOT_FOUND') {
          try {
            await api.profile.onboarding({});
            continue;
          } catch {
            setState((prev) => ({
              ...prev,
              profile: null,
              isAuthenticated: true,
              hasProfile: false,
              isLoading: false,
            }));
            return;
          }
        }

        // The only reason to end the session: the token itself is rejected.
        if (code === 'UNAUTHORIZED') {
          await clearAuth();
          setState((prev) => ({
            ...prev,
            token: null,
            profile: null,
            isAuthenticated: false,
            hasProfile: false,
            isLoading: false,
          }));
          return;
        }

        // Transient error: the token is still valid. Retry, then keep the
        // session rather than logging a correctly-authenticated user back out.
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }
        setState((prev) => ({ ...prev, isAuthenticated: true, isLoading: false }));
      }
    }
    // Reachable when the self-heal above succeeded on the final attempt and
    // there was no attempt left to re-fetch: keep the session; the profile
    // arrives on the next loadProfile.
    setState((prev) => ({ ...prev, isAuthenticated: true, isLoading: false }));
  }, []);

  useEffect(() => {
    getToken().then((token) => {
      if (token) {
        if (isDevFakeToken(token)) {
          setState((prev) => ({
            ...prev,
            token,
            isAuthenticated: true,
            profile: DEV_FAKE_LOGIN.profile,
            hasProfile: true,
            isLoading: false,
          }));
          return;
        }

        setState((prev) => ({ ...prev, token, isAuthenticated: true }));
        void loadProfile();
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    });
  }, [loadProfile]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    if (isDevFakeCredentials(identifier, password)) {
      await storeToken(DEV_FAKE_LOGIN.token);
      await storeUserId(DEV_FAKE_LOGIN.profile.id);
      setState((prev) => ({
        ...prev,
        token: DEV_FAKE_LOGIN.token,
        profile: DEV_FAKE_LOGIN.profile,
        isLoading: false,
        isAuthenticated: true,
        hasProfile: true,
      }));
      return;
    }

    const result = await api.auth.token({ identifier, password });
    await storeToken(result.token);
    await storeUserId(result.userId ?? result.user.id);
    setState((prev) => ({ ...prev, token: result.token, isAuthenticated: true }));
    await loadProfile();
  }, [loadProfile]);

  const signInWithApple = useCallback(
    async ({ identityToken, fullName }: { identityToken: string; fullName?: string }) => {
      const result = await api.auth.apple({ identityToken, fullName });
      await storeToken(result.token);
      await storeUserId(result.userId);
      if (result.isNewUser) {
        // Same reasoning as signUp: identify first so the signup event lands
        // against the person, and "now" is the signup date by definition.
        identifyUser(result.userId, new Date().toISOString());
        track('signup', { method: 'apple' });
      }
      setState((prev) => ({ ...prev, token: result.token, isAuthenticated: true }));
      await loadProfile();
      return { isNewUser: result.isNewUser, hasHandle: result.user.handle != null };
    },
    [loadProfile],
  );

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    if (isDevFakeCredentials(email, password)) {
      await storeToken(DEV_FAKE_LOGIN.token);
      await storeUserId(DEV_FAKE_LOGIN.profile.id);
      setState((prev) => ({
        ...prev,
        token: DEV_FAKE_LOGIN.token,
        profile: DEV_FAKE_LOGIN.profile,
        isLoading: false,
        isAuthenticated: true,
        hasProfile: true,
      }));
      return;
    }
    const { token, user } = await api.auth.register({ name, email, password });
    await storeToken(token);
    await storeUserId(user.id);
    // Identify before the event so `signup` lands against the person rather
    // than an anonymous id that later has to be stitched. The registration
    // response carries no timestamp, but "now" is the signup date by
    // definition here.
    identifyUser(user.id, new Date().toISOString());
    track('signup', { method: 'email' });
    setState((prev) => ({ ...prev, token, isAuthenticated: true }));
    await loadProfile();
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // Cached screen data belongs to this account — never show it to the next.
    clearQueryCache();
    // Same reasoning for the analytics person: the next account signing in on
    // this device must not inherit this one's identity.
    resetIdentity();
    await clearAuth();
    setState({
      token: null,
      profile: null,
      isLoading: false,
      isAuthenticated: false,
      hasProfile: false,
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  return (
    <AuthContext.Provider
      value={{ ...state, signIn, signInWithApple, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
