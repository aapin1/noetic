module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // The Reanimated/Worklets babel plugin is auto-added by babel-preset-expo
    // (SDK 52+) when react-native-worklets is installed. Adding it here too
    // would double-register it, which crashes Reanimated at runtime.
  };
};
