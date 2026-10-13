/**
 * jest-expo's resolver, with react-native-worklets steered away from its
 * `.native` entry points. Worklets ships no jest mock; its native module throws
 * on import in the test runtime, and Reanimated's own mock imports it. The
 * package's suggested resolver (react-native-worklets/jest/resolver.js) does
 * the same extension filtering but delegates to jest's default resolver, which
 * would drop the Expo alias behaviour this suite relies on.
 */
const expoResolver = require(require('jest-expo/jest-preset').resolver);

module.exports = (request, options) => {
  if (options.basedir.includes('react-native-worklets') || request.includes('react-native-worklets')) {
    options = {
      ...options,
      extensions: options.extensions?.filter((ext) => !ext.includes('native')),
    };
  }
  return expoResolver(request, options);
};
