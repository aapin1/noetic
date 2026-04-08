import type { OwnerProfile } from '@/types/api';

export const DEV_FAKE_LOGIN = {
  enabled: true,
  credentials: {
    email: 'ios@noetic.dev',
    password: 'noetic-ios-demo',
  },
  token: 'noetic_dev_fake_token',
  profile: {
    id: 'dev-user-noetic',
    handle: 'ios-demo',
    displayName: 'iOS Demo User',
    bio: 'Temporary simulator account for local UI testing.',
    publicNotes: 'Delete mobile/dev/fake-login.ts and remove AuthContext import to restore normal login.',
    avatarUrl: null,
    followersCount: 42,
    followingCount: 17,
    identitySummary: 'A temporary profile used for iOS simulator sign-in.',
    tasteVector: {
      'topic:philosophy': 0.9,
      'topic:design': 0.72,
      'topic:ai': 0.81,
    },
    email: 'ios@noetic.dev',
    logCount: 12,
    reviewCount: 5,
  } satisfies OwnerProfile,
} as const;
