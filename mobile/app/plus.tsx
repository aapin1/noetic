import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { XIcon } from 'lucide-react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useEntitlements } from '@/hooks/useEntitlements';
import {
  getCurrentPackages,
  isProEntitled,
  presentPaywall,
  purchasePackage,
  restorePurchases,
} from '@/lib/purchases';
import type { UsageMeter } from '@/types/api';

const METER_LABELS: Record<UsageMeter['kind'], string> = {
  social_video_transcript: 'TikTok & Instagram captures',
  image_describe: 'image understanding',
  companion_message: 'companion messages',
  voice_transcription: 'voice notes',
};

const PERKS = [
  'unlimited TikTok & Instagram captures',
  'unlimited image understanding',
  'unlimited companion conversations',
  'unlimited voice notes',
  'no ads, anywhere',
];

const PACKAGE_LABELS: Record<string, string> = {
  MONTHLY: 'Monthly',
  ANNUAL: 'Yearly',
  LIFETIME: 'Lifetime',
};

export default function PlusScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { plan, usage, refetch } = useEntitlements();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const finishPurchase = useCallback(async () => {
    // The RevenueCat webhook flips User.plan server-side; refetching picks it
    // up so ads and caps lift on the next entitlements read.
    await refetch();
    Alert.alert('Welcome to Mneme Plus', 'Thank you for keeping the lights on.');
    router.back();
  }, [refetch, router]);

  useEffect(() => {
    void (async () => {
      // Remote-configured paywall first: designable in the RevenueCat
      // dashboard without an app update. Falls back to the in-app package
      // list when none is configured (e.g. test store, fresh setup).
      const paywall = await presentPaywall();
      if (paywall === true) {
        void finishPurchase();
        return;
      }
      // Dismissed or unavailable: stay on this screen — it still shows the
      // package list, usage meters, and restore.
      const pkgs = await getCurrentPackages();
      setPackages(pkgs);
      setAvailable(pkgs.length > 0);
    })();
    // Intentionally once on mount — re-presenting the paywall on re-render
    // would trap the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const purchase = useCallback(
    async (pkg: PurchasesPackage) => {
      if (busy) return;
      setBusy(true);
      try {
        const info = await purchasePackage(pkg);
        if (isProEntitled(info)) await finishPurchase();
      } catch (err) {
        Alert.alert('Purchase failed', (err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, finishPurchase],
  );

  const restore = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const info = await restorePurchases();
      await refetch();
      Alert.alert(
        isProEntitled(info) ? 'Restored' : 'Nothing to restore',
        isProEntitled(info)
          ? 'Your purchases have been restored.'
          : 'No previous purchases were found for this account.',
      );
    } catch (err) {
      Alert.alert('Restore failed', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, refetch]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">mneme plus</Text>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close">
          <XIcon size={22} color={c.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="serif" color="secondary" style={styles.lede}>
          Mneme is built by one person. Plus keeps it running — and lifts every limit.
        </Text>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          {PERKS.map((perk) => (
            <Text key={perk} variant="body" style={styles.perk}>
              · {perk}
            </Text>
          ))}
        </View>

        {plan === 'PLUS' ? (
          <Text variant="body" style={styles.status}>
            You're on Plus. Thank you.
          </Text>
        ) : available === false ? (
          <Text variant="body" color="muted" style={styles.status}>
            Plus isn't available in this build yet.
          </Text>
        ) : (
          <View style={styles.buttons}>
            {packages.map((pkg) => (
              <Button
                key={pkg.identifier}
                label={`${PACKAGE_LABELS[pkg.packageType] ?? pkg.packageType} · ${pkg.product.priceString}`}
                variant={pkg.packageType === 'ANNUAL' ? 'primary' : 'secondary'}
                size="md"
                fullWidth
                disabled={busy}
                onPress={() => void purchase(pkg)}
              />
            ))}
            <Pressable onPress={() => void restore()}>
              <Text variant="mono" color="muted" style={styles.restore}>
                restore purchases
              </Text>
            </Pressable>
          </View>
        )}

        {usage.length > 0 && plan === 'FREE' ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text variant="mono" color="muted" style={styles.metersTitle}>
              your usage
            </Text>
            {usage.map((meter) => (
              <View key={meter.kind} style={styles.meterRow}>
                <Text variant="caption" color="secondary">
                  {METER_LABELS[meter.kind]}
                </Text>
                <Text variant="mono" color={meter.used >= meter.limit ? 'primary' : 'muted'}>
                  {meter.used}/{meter.limit} this {meter.period}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  content: { padding: Spacing[6], gap: Spacing[6], paddingBottom: Spacing[16] },
  lede: { textAlign: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    gap: Spacing[2],
  },
  perk: {},
  status: { textAlign: 'center' },
  buttons: { gap: Spacing[3] },
  restore: { fontSize: 11, textAlign: 'center', marginTop: Spacing[2] },
  metersTitle: { fontSize: 11 },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
