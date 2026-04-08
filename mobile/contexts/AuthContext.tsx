import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { clearAuth, getToken, storeToken, storeUserId } from '@/lib/storage';
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
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isDevFakeCredentials(email: string, password: string) {
  return (
    DEV_FAKE_LOGIN.enabled &&
    email.trim().toLowerCase() === DEV_FAKE_LOGIN.credentials.email.toLowerCase() &&
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

    try {
      const result = await api.profile.me();
      setState((prev) => ({
        ...prev,
        profile: result.profile,
        hasProfile: true,
        isLoading: false,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        profile: null,
        hasProfile: false,
        isLoading: false,
      }));
    }
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

  const signIn = useCallback(async (email: string, password: string) => {
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

    const result = await api.auth.token({ email, password });
    await storeToken(result.token);
    await storeUserId(result.userId);
    setState((prev) => ({ ...prev, token: result.token, isAuthenticated: true }));
    await loadProfile();
  }, [loadProfile]);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    await api.auth.register({ name, email, password });
    await signIn(email, password);
  }, [signIn]);

  const signOut = useCallback(async () => {
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
      value={{ ...state, signIn, signUp, signOut, refreshProfile }}
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
