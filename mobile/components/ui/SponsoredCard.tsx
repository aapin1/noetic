import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { useEntitlements } from '@/hooks/useEntitlements';

// Type-only import — erased at compile time, so it never touches the native
// module.
import type { NativeAd as NativeAdInstance } from 'react-native-google-mobile-ads';

/**
 * Every failure in the ad path is deliberately silent in production — a
 * missing ad must never disturb the screen. That makes "no ads anywhere"
 * impossible to diagnose, so in dev each boundary reports itself. Grep the
 * Metro console for [ads] to see exactly which layer gave up.
 */
const adLog = (...args: unknown[]) => {
  if (__DEV__) console.log('[ads]', ...args);
};

// The ad SDK is a native module: in a dev client built before it was added,
// the import throws — the card just renders nothing until the next native
// build, keeping the JS bundle loadable everywhere.
type AdsModule = typeof import('react-native-google-mobile-ads');
let ads: AdsModule | null = null;
try {
  ads = require('react-native-google-mobile-ads');
  adLog('native module loaded');
} catch (e) {
  ads = null;
  adLog('native module MISSING — this dev client was built without it. Rebuild:', e);
}

let initialized = false;
async function initAds(): Promise<boolean> {
  if (!ads) return false;
  if (initialized) return true;
  try {
    if (__DEV__) {
      // A real unit must never serve a live ad to a dev build — that's
      // invalid traffic. Simulators the SDK registers itself; a physical
      // device needs its id, which the native log prints on first request.
      const device = process.env.EXPO_PUBLIC_ADMOB_TEST_DEVICE_ID;
      await ads.default().setRequestConfiguration({
        testDeviceIdentifiers: ['EMULATOR', ...(device ? [device] : [])],
      });
      adLog('test-device config set', device ? `(+${device})` : '(simulator only)');
    }
    // ATT first: consent decides whether Google may serve personalized ads
    // (which pay several times more than contextual ones).
    try {
      const att = require('expo-tracking-transparency') as typeof import('expo-tracking-transparency');
      const { status } = await att.getTrackingPermissionsAsync();
      if (status === 'undetermined') await att.requestTrackingPermissionsAsync();
    } catch {
      // tracking module unavailable — non-personalized ads still work
    }
    await ads.default().initialize();
    initialized = true;
    adLog('SDK initialized');
    return true;
  } catch (e) {
    adLog('SDK initialize FAILED:', e);
    return false;
  }
}

/**
 * A single Mneme-styled native ad. Renders nothing for Plus members, while
 * the ad loads, or when no fill/SDK is available — the screen never shows a
 * placeholder or shifts layout for a missing ad.
 *
 * `tone="dark"` is for the surfaces that stay dark in both themes (Mind's
 * stage, the Atlas map background), where the themed surface color would
 * otherwise punch a bright rectangle into the canvas.
 */
export function SponsoredCard({ tone = 'auto' }: { tone?: 'auto' | 'dark' } = {}) {
  const c = useThemeColors();
  const router = useRouter();
  const { plan, loading } = useEntitlements();
  const [nativeAd, setNativeAd] = useState<NativeAdInstance | null>(null);

  // Fail OPEN: ads are the app's default state, so only a confirmed PLUS plan
  // removes them. Requiring plan === 'FREE' meant any entitlements hiccup — a
  // slow cold backend, a 500, a signed-out blip — silently disabled every ad
  // in the app with nothing on screen to say so.
  //
  // `plan !== null || !loading` is what keeps that from flickering: a known
  // plan (even a stale cached one) counts as settled, so a background
  // revalidate can't briefly flip this false and tear down a loaded ad, and a
  // failed first load still ends up showing ads once it stops loading.
  const settled = plan !== null || !loading;
  const showAds = settled && plan !== 'PLUS' && ads !== null;

  useEffect(() => {
    adLog('gate:', { plan, loading, settled, showAds, hasModule: ads !== null });
  }, [plan, loading, settled, showAds]);

  useEffect(() => {
    if (!showAds || !ads) return;
    let disposed = false;
    let loaded: NativeAdInstance | null = null;

    void (async () => {
      if (!(await initAds()) || disposed) return;
      // Dev stays on the demo unit: it costs nothing, carries no
      // invalid-traffic risk, and starts filling the moment the AdMob account
      // is approved. Real units only ever ship via the EAS env var.
      const adUnitId = process.env.EXPO_PUBLIC_ADMOB_NATIVE_UNIT_ID ?? ads!.TestIds.NATIVE;
      try {
        loaded = await ads!.NativeAd.createForAdRequest(adUnitId);
        adLog('ad loaded from', adUnitId);
        if (disposed) loaded.destroy();
        else setNativeAd(loaded);
      } catch (e) {
        adLog('ad request FAILED for', adUnitId, '-', e);
        // no fill / request error — stay invisible
      }
    })();

    return () => {
      disposed = true;
      loaded?.destroy();
    };
  }, [showAds]);

  if (!showAds || !nativeAd || !ads) return null;

  const { NativeAdView, NativeAsset, NativeAssetType, NativeMediaView } = ads;

  const dark = tone === 'dark';
  const surface = dark ? 'rgba(255,255,255,0.05)' : c.surface;
  const border = dark ? 'rgba(236,236,236,0.14)' : c.border;
  // On a dark stage the themed text colors go near-black, so drive the ad's
  // copy off the same light ink the rest of that stage uses.
  const ink = dark ? { color: 'rgba(236,236,236,0.92)' } : undefined;
  const inkMuted = dark ? { color: 'rgba(236,236,236,0.45)' } : undefined;

  return (
    <View style={styles.wrap}>
      <NativeAdView nativeAd={nativeAd}>
        <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
          <View style={styles.topRow}>
            <Text variant="mono" color="muted" style={[styles.sponsored, inkMuted]}>
              sponsored
            </Text>
          </View>
          <View style={styles.body}>
            {nativeAd.icon?.url ? (
              <NativeAsset assetType={NativeAssetType.ICON}>
                <Image source={{ uri: nativeAd.icon.url }} style={styles.icon} />
              </NativeAsset>
            ) : null}
            <View style={styles.textCol}>
              <NativeAsset assetType={NativeAssetType.HEADLINE}>
                <Text variant="body" style={ink}>{nativeAd.headline ?? ''}</Text>
              </NativeAsset>
              {nativeAd.body ? (
                <NativeAsset assetType={NativeAssetType.BODY}>
                  <Text variant="caption" color="secondary" numberOfLines={2} style={inkMuted}>
                    {nativeAd.body}
                  </Text>
                </NativeAsset>
              ) : null}
            </View>
            {nativeAd.callToAction ? (
              <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
                <View style={[styles.cta, { borderColor: border }]}>
                  <Text variant="mono" style={[styles.ctaText, ink]}>
                    {nativeAd.callToAction}
                  </Text>
                </View>
              </NativeAsset>
            ) : null}
          </View>
          {/* Google's native-ad policy requires the main image/video asset to
              be shown via MediaView (not a plain Image); it also lets video
              creatives play. Kept as a slim strip to fit the minimal card. */}
          <NativeMediaView style={styles.media} resizeMode="cover" />
        </View>
      </NativeAdView>
      <Pressable
        onPress={() => router.push('/plus' as never)}
        accessibilityRole="button"
        accessibilityLabel="Remove ads with Mneme Plus"
        hitSlop={10}
      >
        <Text variant="mono" color="muted" style={[styles.removeLink, inkMuted]}>
          remove ads with mneme plus →
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Symmetric vertical margin so the "mneme plus" link never crowds the card
  // that follows the ad in any of the streams it appears in.
  wrap: { paddingHorizontal: Spacing[6], marginTop: Spacing[6], marginBottom: Spacing[6] },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[4],
  },
  topRow: { marginBottom: Spacing[2] },
  sponsored: { fontSize: 11, textTransform: 'lowercase' },
  body: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  media: {
    width: '100%',
    height: 150,
    borderRadius: Radius.md,
    marginTop: Spacing[3],
    overflow: 'hidden',
  },
  icon: { width: 40, height: 40, borderRadius: Radius.md },
  textCol: { flex: 1, gap: 2 },
  cta: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
  },
  ctaText: { fontSize: 12 },
  removeLink: { fontSize: 11, textAlign: 'center', marginTop: Spacing[3] },
});
