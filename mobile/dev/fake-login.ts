import type { OwnerProfile } from '@/types/api';

export const DEV_FAKE_LOGIN = {
  enabled: false,
  credentials: {
    email: 'ios@noetic.dev',
    password: 'noetic-ios-demo',
  },
  token: 'noetic_dev_fake_token',
  profile: {
    id: 'dev-user-noetic',
    handle: 'ios-demo',
    displayName: 'iOS Demo User',
    bio: 'Local-only profile used for offline UI testing.',
    publicNotes: null,
    avatarUrl: null,
    identitySummary: null,
    email: 'ios@noetic.dev',
    isOnboarded: true,
  } satisfies OwnerProfile,
} as const;
