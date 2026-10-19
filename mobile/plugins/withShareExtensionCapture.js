// Replaces the ShareViewController that expo-share-intent generates with one
// that captures from inside the share sheet: it reads the session token from
// the app-group keychain, posts the shared item to the backend, shows a small
// "saved to your map" card, and dismisses. It never opens the host app —
// Apple's stance is that extensions must not open URLs, the responder-chain
// trick the stock controller relies on is what breaks on real iOS 26 devices,
// and the product wants sharing to be a background log anyway.
//
// A finalized mod runs after every other iOS mod, i.e. after expo-share-intent
// has written its own controller, so the overwrite always wins.
const { withFinalizedMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const PROD_API_URL = 'https://mneme-backend.onrender.com';
const TEMPLATE = path.join(__dirname, 'ShareViewController.swift');

function shareIntentParams(config) {
  const entry = (config.plugins ?? []).find(
    (p) => (Array.isArray(p) ? p[0] : p) === 'expo-share-intent',
  );
  return (Array.isArray(entry) && entry[1]) || {};
}

module.exports = function withShareExtensionCapture(config) {
  return withFinalizedMod(config, [
    'ios',
    async (config) => {
      const params = shareIntentParams(config);
      const bundleId = config.ios?.bundleIdentifier;
      if (!bundleId) throw new Error('withShareExtensionCapture: ios.bundleIdentifier is required');
      // Mirrors expo-share-intent's own naming so the app, the extension target
      // and the keychain access group in lib/storage.ts all agree.
      const appGroup = params.iosAppGroupIdentifier || `group.${bundleId}`;
      const extName = (params.iosShareExtensionName || 'ShareExtension').replace(/[^a-zA-Z0-9]/g, '');
      // EXPO_PUBLIC_API_URL is what the app itself is built against (eas.json
      // sets it per profile); the extension must talk to the same backend.
      const apiUrl = (process.env.EXPO_PUBLIC_API_URL || PROD_API_URL).replace(/\/+$/, '');

      const swift = fs
        .readFileSync(TEMPLATE, 'utf8')
        .replace(/__APP_GROUP__/g, appGroup)
        .replace(/__API_URL__/g, apiUrl);
      const target = path.join(config.modRequest.platformProjectRoot, extName, 'ShareViewController.swift');
      if (!fs.existsSync(path.dirname(target))) {
        throw new Error(`withShareExtensionCapture: ${path.dirname(target)} missing — is expo-share-intent configured?`);
      }
      fs.writeFileSync(target, swift);
      return config;
    },
  ]);
};
