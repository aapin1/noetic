import { getShareExtensionKey } from 'expo-share-intent';

/**
 * When iOS/Android hands off a shared item, expo-share-intent deep-links into
 * the app with the share extension key in the path. Redirect those launches to
 * the dedicated handler screen; leave every other deep link untouched.
 */
export function redirectSystemPath({ path }: { path: string; initial: string }) {
  if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
    return '/shareintent';
  }
  return path;
}
