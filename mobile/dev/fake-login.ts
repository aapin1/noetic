import type { OwnerProfile } from '@/types/api';

export const DEV_FAKE_LOGIN = {
  enabled: false,
  credentials: {
    email: 'ios@mneme.dev',
    password: 'mneme-ios-demo',
  },
  token: 'mneme_dev_fake_token',
  profile: {
    id: 'dev-user-mneme',
    handle: 'ios-demo',
    displayName: 'iOS Demo User',
    bio: 'Local-only profile used for offline UI testing.',
    publicNotes: null,
    avatarUrl: null,
    identitySummary: null,
    email: 'ios@mneme.dev',
    isOnboarded: true,
  } satisfies OwnerProfile,
} as const;
