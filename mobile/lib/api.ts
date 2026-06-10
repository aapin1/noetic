import Constants from 'expo-constants';
import { getToken } from '@/lib/storage';
import type {
  ApiResponse,
  CaptureKind,
  CaptureResponse,
  CaptureDetail,
  CaptureSummary,
  IngestedMetadata,
  InsightStyle,
  MemoryGraphResponse,
  MemoryTrendsResponse,
  OwnerProfile,
  PersonalIntelligenceResponse,
  UserPreference,
} from '@/types/api';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://localhost:3000';

function getValidationMessage(issues: unknown): string | null {
  if (!issues || typeof issues !== 'object') return null;

  const fieldErrors = (issues as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== 'object') return null;

  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (!Array.isArray(messages) || messages.length === 0) continue;
    const first = messages.find((message): message is string => typeof message === 'string');
    if (first) return `${field}: ${first}`;
  }

  return null;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const json = (await res.json()) as ApiResponse<T>;

  if (!json.ok) {
    const message =
      json.error.code === 'VALIDATION_ERROR'
        ? getValidationMessage(json.error.issues) ?? json.error.message
        : json.error.message;
    const err = new Error(message);
    (err as Error & { code: string }).code = json.error.code;
    throw err;
  }

  return json.data;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  auth: {
    register(body: { name: string; email: string; password: string }) {
      return request<{ user: { id: string; email: string; name: string | null }; token: string }>(
        '/api/auth/register',
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    token(body: { email: string; password: string }) {
      return request<{
        token: string;
        /** Present on current API; older servers may omit—use `user.id` as fallback. */
        userId?: string;
        user: { id: string; email: string; name: string | null; handle: string | null };
      }>('/api/auth/token', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  },

  profile: {
    async me(): Promise<{ profile: OwnerProfile }> {
      const composed = await request<{
        user: { id: string; name?: string | null; profile: OwnerProfile & { isOnboarded?: boolean } };
      }>('/api/me/profile');
      return { profile: { ...composed.user.profile, id: composed.user.id } };
    },
    async onboarding(body: {
      topics: string[];
      handle?: string;
      displayName?: string;
      bio?: string;
      insightStyle?: import('@/types/api').InsightStyle;
    }): Promise<{ profile: OwnerProfile }> {
      return request<{ profile: OwnerProfile }>('/api/profile/onboarding', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    async update(body: Partial<{
      handle: string;
      displayName: string;
      bio: string;
      publicNotes: string;
      avatarUrl: string;
      topics: string[];
    }>): Promise<{ profile: OwnerProfile }> {
      const composed = await request<{
        user: { id: string; profile: OwnerProfile };
      }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return { profile: { ...composed.user.profile, id: composed.user.id } };
    },
  },

  preferences: {
    get() {
      return request<UserPreference>('/api/me/preferences');
    },
    update(body: { insightStyle?: InsightStyle; preferences?: Record<string, unknown> }) {
      return request<UserPreference>('/api/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
  },

  content: {
    ingest(url: string) {
      return request<{ contentItem: IngestedMetadata; requiresManualInput: boolean }>(
        '/api/content/ingest',
        { method: 'POST', body: JSON.stringify({ url }) },
      );
    },
  },

  captures: {
    create(body: {
      kind: CaptureKind;
      url?: string;
      text?: string;
      caption?: string;
      mediaUrl?: string;
      reaction?: string;
      topicHints?: string[];
    }) {
      return request<CaptureResponse>('/api/captures', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    upload(imageBase64: string, mimeType?: string) {
      return request<{ mediaUrl: string }>('/api/captures/upload', {
        method: 'POST',
        body: JSON.stringify({ imageBase64, mimeType }),
      });
    },
    list(params?: { limit?: number }) {
      return request<CaptureSummary[]>(`/api/captures${buildQuery(params ?? {})}`);
    },
    get(id: string) {
      return request<CaptureDetail>(`/api/captures/${id}`);
    },
  },

  memory: {
    graph(params?: { limit?: number }) {
      return request<MemoryGraphResponse>(`/api/memory/graph${buildQuery(params ?? {})}`);
    },
    trends(params?: { window?: 'week' | 'month' }) {
      return request<MemoryTrendsResponse>(`/api/memory/trends${buildQuery(params ?? {})}`);
    },
    intelligence() {
      return request<PersonalIntelligenceResponse>('/api/memory/intelligence');
    },
  },
};
