import Constants from 'expo-constants';
import { getToken } from '@/lib/storage';
import type {
  ApiResponse,
  ArchiveFolderDetail,
  ArchiveFolderSummary,
  CaptureKind,
  CapturePreflight,
  CaptureResponse,
  CaptureDetail,
  CaptureSummary,
  CompanionMessage,
  CompanionThread,
  FeedResponse,
  IngestedMetadata,
  InsightStyle,
  MemoryGraphResponse,
  MemoryTrendsResponse,
  OwnerProfile,
  WrappedStats,
  PersonalIntelligenceResponse,
  PulseResponse,
  UserPreference,
  UserPosition,
  SocraticThread,
  SocraticMessage,
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

/**
 * Fire-and-forget wake-up call for the backend. Render spins the instance
 * down when idle and the first real request then eats the cold start — pinging
 * /api/health the moment the app opens lets the server boot while the user is
 * still looking at cached screens.
 */
export function warmBackend(): void {
  fetch(`${BASE_URL}/api/health`).catch(() => {
    // Purely best-effort; real requests surface their own errors.
  });
}

export const api = {
  plus: {
    /** Plan + current-period usage — drives ad visibility and the paywall. */
    entitlements() {
      return request<import('@/types/api').Entitlements>('/api/me/entitlements');
    },
  },

  account: {
    /** Permanently deletes the signed-in account and all of its data. */
    delete() {
      return request<{ deleted: true }>('/api/me/account', { method: 'DELETE' });
    },
  },

  auth: {
    register(body: { name: string; email: string; password: string }) {
      return request<{ user: { id: string; email: string; name: string | null }; token: string }>(
        '/api/auth/register',
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    token(body: { identifier: string; password: string }) {
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
        user: { id: string; name?: string | null; createdAt?: string; profile: OwnerProfile & { isOnboarded?: boolean } };
      }>('/api/me/profile');
      return { profile: { ...composed.user.profile, id: composed.user.id, createdAt: composed.user.createdAt } };
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
    async uploadAvatar(imageBase64: string, mimeType?: string): Promise<{ profile: OwnerProfile }> {
      const composed = await request<{
        user: { id: string; createdAt?: string; profile: OwnerProfile };
      }>('/api/profile/avatar', {
        method: 'POST',
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      return { profile: { ...composed.user.profile, id: composed.user.id, createdAt: composed.user.createdAt } };
    },
    async removeAvatar(): Promise<{ profile: OwnerProfile }> {
      const composed = await request<{
        user: { id: string; createdAt?: string; profile: OwnerProfile };
      }>('/api/profile/avatar', {
        method: 'POST',
        body: JSON.stringify({ remove: true }),
      });
      return { profile: { ...composed.user.profile, id: composed.user.id, createdAt: composed.user.createdAt } };
    },
    wrapped(): Promise<WrappedStats> {
      // Buckets ("last 24 hours", "Tuesdays at 3pm") only make sense on the
      // device's clock, so the server needs the offset to bucket against.
      const tzOffsetMinutes = -new Date().getTimezoneOffset();
      return request<WrappedStats>(`/api/me/wrapped?tzOffsetMinutes=${tzOffsetMinutes}`);
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
      userContext?: string;
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
    preflight(url: string) {
      return request<CapturePreflight>('/api/captures/preflight', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
    },
    transcribe(audioBase64: string, mimeType?: string) {
      return request<{ text: string }>('/api/captures/transcribe', {
        method: 'POST',
        body: JSON.stringify({ audioBase64, mimeType }),
      });
    },
    updateContext(id: string, userContext: string) {
      return request<CaptureDetail>(`/api/captures/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ userContext }),
      });
    },
    delete(id: string) {
      return request<{ deleted: true }>(`/api/captures/${id}`, {
        method: 'DELETE',
      });
    },
    list(params?: { limit?: number; query?: string }) {
      return request<CaptureSummary[]>(`/api/captures${buildQuery(params ?? {})}`);
    },
    get(id: string) {
      return request<CaptureDetail>(`/api/captures/${id}`);
    },
  },

  archive: {
    list() {
      return request<{ folders: ArchiveFolderSummary[] }>('/api/archive');
    },
    get(topicId: string) {
      return request<ArchiveFolderDetail>(`/api/archive/${topicId}`);
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

  positions: {
    list() {
      return request<UserPosition[]>('/api/positions');
    },
    create(body: { topicId: string; statement: string; captureCountAtCreation: number }) {
      return request<UserPosition>('/api/positions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getByTopic(topicId: string) {
      return request<UserPosition>(`/api/positions/${topicId}`);
    },
    acknowledge(challengeId: string, revision?: string) {
      return request<{ acknowledged: boolean }>(
        `/api/positions/challenges/${challengeId}`,
        { method: 'PATCH', body: JSON.stringify({ revision }) },
      );
    },
  },

  social: {
    feed(params?: { cursor?: string; limit?: number }) {
      return request<FeedResponse>(`/api/social/feed${buildQuery(params ?? {})}`);
    },
    pulse() {
      return request<PulseResponse>('/api/social/pulse');
    },
    follow(targetUserId: string) {
      return request<{ following: boolean }>('/api/social/follow', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
    },
    unfollow(targetUserId: string) {
      return request<{ following: boolean }>('/api/social/unfollow', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
    },
    searchUsers(query: string) {
      return request<{ users: { id: string; handle: string; displayName: string; avatarUrl: string | null }[] }>(
        `/api/social/users${buildQuery({ q: query })}`,
      );
    },
  },

  socratic: {
    getThread(topicId: string) {
      return request<SocraticThread>(`/api/socratic/${topicId}`);
    },
    reply(topicId: string, content: string) {
      return request<{ userMessage: SocraticMessage; companionMessage: SocraticMessage }>(
        `/api/socratic/${topicId}/reply`,
        { method: 'POST', body: JSON.stringify({ content }) },
      );
    },
  },

  companion: {
    getThread() {
      return request<CompanionThread>('/api/companion');
    },
    reply(content: string, contextItemIds?: string[]) {
      return request<{ userMessage: CompanionMessage; companionMessage: CompanionMessage }>(
        '/api/companion/reply',
        { method: 'POST', body: JSON.stringify({ content, contextItemIds }) },
      );
    },
  },
};
