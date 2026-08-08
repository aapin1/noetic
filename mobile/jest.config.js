/**
 * Screen-level tests: render a real screen against mocked API payloads and
 * assert on what the user would actually see.
 *
 * Scoped to `__tests__/*.test.tsx` on purpose. `mobile/lib/*.test.ts` belongs to
 * the root vitest suite (see vitest.config.ts) and imports from "vitest", so
 * jest must not pick those up.
 */
module.exports = {
  preset: 'jest-expo',
  rootDir: '.',
  testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // No moduleNameMapper here: the jest-expo preset already maps "@/" and
  // react-native, and defining the key at all would replace its map wholesale.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-reanimated|react-native-worklets|lucide-react-native|posthog-react-native|@sentry/react-native)',
  ],
};
