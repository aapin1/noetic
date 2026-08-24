// Dynamic config on top of app.json. One switch: APP_VARIANT=development gives
// the dev client its own bundle id and name, so it installs NEXT TO the App
// Store build instead of replacing it. Everything else comes from app.json.
const base = require('./app.json');

const variant = process.env.APP_VARIANT;
const isDev = variant === 'development';

module.exports = ({ config }) => {
  const expo = { ...base.expo, ...config };
  if (!isDev) return expo;
  return {
    ...expo,
    name: 'mneme dev',
    scheme: 'mneme-dev',
    ios: { ...expo.ios, bundleIdentifier: 'app.mneme.mobile.dev' },
    android: { ...expo.android, package: 'app.mneme.mobile.dev' },
  };
};
