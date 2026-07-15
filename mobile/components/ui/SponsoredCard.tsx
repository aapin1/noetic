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

// The ad SDK is a native module: in a dev client built before it was added,
// the import throws — the card just renders nothing until the next native
// build, keeping the JS bundle loadable everywhere.
type AdsModule = typeof import('react-native-google-mobile-ads');
let ads: AdsModule | null = null;
try {
  ads = require('react-native-google-mobile-ads');
} catch {
  ads = null;
}

let initialized = false;
async function initAds(): Promise<boolean> {
  if (!ads) return false;
  if (initialized) return true;
  try {
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
    return true;
  } catch {
    return false;
  }
}

/**
 * A single Mneme-styled native ad. Renders nothing for Plus members, while
 * the ad loads, or when no fill/SDK is available — the screen never shows a
 * placeholder or shifts layout for a missing ad.
 */
export function SponsoredCard() {
  const c = useThemeColors();
  const router = useRouter();
  const { plan } = useEntitlements();
  const [nativeAd, setNativeAd] = useState<NativeAdInstance | null>(null);

  const showAds = plan === 'FREE' && ads !== null;

  useEffect(() => {
    if (!showAds || !ads) return;
    let disposed = false;
    let loaded: NativeAdInstance | null = null;

    void (async () => {
      if (!(await initAds()) || disposed) return;
      try {
        const adUnitId = process.env.EXPO_PUBLIC_ADMOB_NATIVE_UNIT_ID ?? ads!.TestIds.NATIVE;
        loaded = await ads!.NativeAd.createForAdRequest(adUnitId);
        if (disposed) loaded.destroy();
        else setNativeAd(loaded);
      } catch {
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

  return (
    <View style={styles.wrap}>
      <NativeAdView nativeAd={nativeAd}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.topRow}>
            <Text variant="mono" color="muted" style={styles.sponsored}>
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
                <Text variant="body">{nativeAd.headline ?? ''}</Text>
              </NativeAsset>
              {nativeAd.body ? (
                <NativeAsset assetType={NativeAssetType.BODY}>
                  <Text variant="caption" color="secondary" numberOfLines={2}>
                    {nativeAd.body}
                  </Text>
                </NativeAsset>
              ) : null}
            </View>
            {nativeAd.callToAction ? (
              <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
                <View style={[styles.cta, { borderColor: c.border }]}>
                  <Text variant="mono" style={styles.ctaText}>
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
      <Pressable onPress={() => router.push('/plus' as never)}>
        <Text variant="mono" color="muted" style={styles.removeLink}>
          remove ads with mneme plus →
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing[6], marginTop: Spacing[6] },
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
  removeLink: { fontSize: 11, textAlign: 'center', marginTop: Spacing[2] },
});
