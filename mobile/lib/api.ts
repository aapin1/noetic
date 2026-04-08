import Constants from 'expo-constants';
import { getToken } from '@/lib/storage';
import type {
  ApiResponse,
  OwnerProfile,
  UserProfile,
  FeedItem,
  SearchResults,
  CompareResult,
  TopicPage,
  ContentPage,
  LogEntry,
  RankingList,
  IngestedMetadata,
  Notification,
} from '@/types/api';

const BASE_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://localhost:3000';

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
    const err = new Error(json.error.message);
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
      return request<{ userId: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    token(body: { email: string; password: string }) {
      return request<{ token: string; userId: string }>('/api/auth/token', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  },

  profile: {
    me() {
      return request<{ profile: OwnerProfile }>('/api/me/profile');
    },
    onboarding(body: {
      handle: string;
      displayName: string;
      bio?: string;
      topics?: string[];
    }) {
      return request<{ profile: OwnerProfile }>('/api/profile/onboarding', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    update(body: Partial<{
      handle: string;
      displayName: string;
      bio: string;
      publicNotes: string;
      avatarUrl: string;
      topics: string[];
    }>) {
      return request<{ profile: OwnerProfile }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    getByHandle(handle: string) {
      return request<{ profile: UserProfile }>(`/api/profiles/${handle}`);
    },
  },

  feed: {
    get(params?: { sort?: 'relevance' | 'chronological'; limit?: number }) {
      return request<FeedItem[]>(`/api/feed${buildQuery(params ?? {})}`);
    },
  },

  content: {
    ingest(url: string) {
      return request<{ contentItem: IngestedMetadata; requiresManualInput: boolean }>(
        '/api/content/ingest',
        { method: 'POST', body: JSON.stringify({ url }) },
      );
    },
    manual(body: {
      title: string;
      description?: string;
      canonicalUrl?: string;
      contentType?: string;
      sourceName?: string;
      topics?: string[];
    }) {
      return request<{ contentItem: { id: string } }>('/api/content/manual', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getById(id: string) {
      return request<ContentPage>(`/api/content/${id}`);
    },
  },

  logs: {
    create(body: {
      contentItemId: string;
      rating?: number;
      annotation?: string;
      review?: string;
      topics?: string[];
      visibility?: string;
    }) {
      return request<LogEntry>('/api/logs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    updateReview(body: {
      logEntryId: string;
      content: string;
      visibility?: string;
    }) {
      return request<LogEntry>('/api/reviews', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
  },

  rankings: {
    upsert(body: {
      rankingListId?: string;
      title: string;
      description?: string;
      visibility?: string;
      items: { contentItemId: string; note?: string }[];
    }) {
      return request<RankingList>('/api/rankings', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    reorder(body: { rankingListId: string; contentItemIds: string[] }) {
      return request<RankingList>('/api/rankings/reorder', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  },

  social: {
    follow(targetUserId: string) {
      return request<void>('/api/social/follow', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
    },
    unfollow(targetUserId: string) {
      return request<void>('/api/social/unfollow', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
    },
    likeReview(reviewId: string) {
      return request<void>('/api/social/like', {
        method: 'POST',
        body: JSON.stringify({ reviewId }),
      });
    },
    saveContent(contentItemId: string) {
      return request<void>('/api/social/save', {
        method: 'POST',
        body: JSON.stringify({ contentItemId }),
      });
    },
    comment(body: {
      reviewId: string;
      content: string;
      parentId?: string;
      visibility?: string;
    }) {
      return request<void>('/api/social/comment', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  },

  search: {
    query(params: { query: string; limit?: number }) {
      return request<SearchResults>(`/api/search${buildQuery(params)}`);
    },
  },

  compare: {
    profiles(targetHandle: string) {
      return request<CompareResult>(`/api/compare${buildQuery({ targetHandle })}`);
    },
  },

  topics: {
    get(slug: string, limit?: number) {
      return request<TopicPage>(`/api/topics/${slug}${buildQuery({ limit })}`);
    },
  },

  notifications: {
    list() {
      return request<Notification[]>('/api/notifications');
    },
  },

  deviceTokens: {
    register(token: string, platform: string) {
      return request<void>('/api/device-tokens', {
        method: 'POST',
        body: JSON.stringify({ token, platform }),
      });
    },
  },
};
