/**
 * Shared mocks for screen tests.
 *
 * The rule here: mock the *edges* (network, navigation, native modules) and
 * nothing else. Screens, hooks, theming, and component logic all run for real —
 * that's the part these tests exist to check.
 */
/* eslint-env jest */

// React 19 only applies queued state updates inside `act()` when it knows it is
// in a test environment. Without this, every async setState (the query hook, the
// visit call) is warned about and dropped, so screens never leave their loading
// state and every findBy* times out.
global.IS_REACT_ACT_ENVIRONMENT = true;

// --- native modules with no JS implementation in the test runtime ------------

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// The query cache in hooks/useApiQuery.ts persists through AsyncStorage; its
// official in-memory mock keeps that path real instead of stubbing the hook.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(async () => false),
  requestReview: jest.fn(async () => undefined),
}));

jest.mock('expo-tracking-transparency', () => ({
  requestTrackingPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getTrackingPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Ads and IAP reach out to real SDKs on load; neither is meaningful off-device.
jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({ initialize: jest.fn(async () => []) }),
  BannerAd: () => null,
  BannerAdSize: { BANNER: 'BANNER', MEDIUM_RECTANGLE: 'MEDIUM_RECTANGLE' },
  TestIds: { BANNER: 'test-banner' },
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {} } })),
    getOfferings: jest.fn(async () => ({ current: null })),
  },
}));

// Analytics/crash reporting: assert-free no-ops.
jest.mock('posthog-react-native', () => ({
  PostHog: jest.fn().mockImplementation(() => ({ capture: jest.fn(), identify: jest.fn() })),
  usePostHog: () => ({ capture: jest.fn(), identify: jest.fn() }),
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  wrap: (component) => component,
}));

/**
 * lucide-react-native ships ESM-only `.mjs`, which babel-jest won't transform.
 * Icons carry no text and nothing here asserts on them, so every named export
 * resolves to a component that renders nothing.
 */
jest.mock('lucide-react-native', () => {
  const React = require('react');
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === '__esModule') return true;
        return () => React.createElement('Icon', { testID: `icon-${String(name)}` });
      },
    },
  );
});

// --- navigation -------------------------------------------------------------

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// the imports, so a factory may only close over variables named this way.
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismiss: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  useFocusEffect: jest.fn(),
  usePathname: () => '/',
  Link: ({ children }) => children,
  Stack: { Screen: () => null },
  router: mockRouter,
}));

// Exposed so a test can assert where a press navigated to.
global.__routerMock = mockRouter;

beforeEach(() => {
  Object.values(mockRouter).forEach((fn) => fn.mockClear());
});
