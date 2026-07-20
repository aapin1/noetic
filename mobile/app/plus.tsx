import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckIcon, XIcon } from 'lucide-react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { Radius, Spacing, accentFor } from '@/constants/theme';
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

const ACCENT = accentFor(7);

const METER_LABELS: Record<UsageMeter['kind'], string> = {
  social_video_transcript: 'TikTok & Instagram captures',
  image_describe: 'image understanding',
  companion_message: 'companion messages',
  voice_transcription: 'voice notes',
};

const PERKS = [
  'no ads, anywhere',
  'unlimited TikTok & Instagram captures',
  'unlimited image understanding',
  'unlimited companion conversations',
  'unlimited voice notes',
];

const PACKAGE_LABELS: Record<string, string> = {
  MONTHLY: 'Monthly',
  ANNUAL: 'Yearly',
  LIFETIME: 'Lifetime',
};

const PACKAGE_SUBLABELS: Record<string, string> = {
  MONTHLY: 'billed monthly',
  ANNUAL: 'billed once a year',
  LIFETIME: 'pay once, keep forever',
};

/** Yearly savings vs. paying monthly, when both plans are on offer. */
function annualSavingsPct(packages: PurchasesPackage[]): number | null {
  const monthly = packages.find((p) => p.packageType === 'MONTHLY');
  const annual = packages.find((p) => p.packageType === 'ANNUAL');
  const m = monthly?.product.price;
  const a = annual?.product.price;
  if (typeof m !== 'number' || typeof a !== 'number' || m <= 0) return null;
  const pct = Math.round((1 - a / 12 / m) * 100);
  return pct > 0 ? pct : null;
}

export default function PlusScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { plan, usage, refetch } = useEntitlements();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const savings = useMemo(() => annualSavingsPct(packages), [packages]);

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
      // Default the selection to the best-value plan (yearly) when present.
      const preferred = pkgs.find((p) => p.packageType === 'ANNUAL') ?? pkgs[0];
      setSelectedId(preferred?.identifier ?? null);
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

  const selected = packages.find((p) => p.identifier === selectedId) ?? null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">mneme plus</Text>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close" hitSlop={10}>
          <XIcon size={22} color={c.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text variant="h1" style={styles.heroTitle}>
            Everything, unlimited.
          </Text>
          <Text variant="serif" color="secondary" style={styles.lede}>
            Mneme is built by one person. Plus keeps it running — and lifts every limit.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          {PERKS.map((perk) => (
            <View key={perk} style={styles.perkRow}>
              <View style={[styles.check, { backgroundColor: ACCENT }]}>
                <CheckIcon size={12} color="#fff" strokeWidth={3} />
              </View>
              <Text variant="body" style={styles.perkText}>
                {perk}
              </Text>
            </View>
          ))}
        </View>

        {plan === 'PLUS' ? (
          <View style={[styles.card, styles.statusCard, { backgroundColor: c.surface, borderColor: ACCENT }]}>
            <Text variant="h3" style={{ color: ACCENT }}>
              You're on Plus
            </Text>
            <Text variant="serif" color="secondary" style={styles.statusBody}>
              Every limit is lifted, and the ads are gone. Thank you for keeping the lights on.
            </Text>
          </View>
        ) : available === false ? (
          <Text variant="body" color="muted" style={styles.status}>
            Plus isn't available in this build yet.
          </Text>
        ) : (
          <View style={styles.buttons}>
            {packages.map((pkg) => {
              const on = pkg.identifier === selectedId;
              const isAnnual = pkg.packageType === 'ANNUAL';
              return (
                <Pressable
                  key={pkg.identifier}
                  onPress={() => setSelectedId(pkg.identifier)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.planCard,
                    { backgroundColor: c.surface, borderColor: on ? ACCENT : c.border },
                    on && styles.planCardOn,
                  ]}
                >
                  <View style={[styles.radio, { borderColor: on ? ACCENT : c.faint }]}>
                    {on ? <View style={[styles.radioDot, { backgroundColor: ACCENT }]} /> : null}
                  </View>
                  <View style={styles.planText}>
                    <View style={styles.planTop}>
                      <Text variant="bodyMedium">{PACKAGE_LABELS[pkg.packageType] ?? pkg.packageType}</Text>
                      {isAnnual && savings ? (
                        <View style={[styles.savePill, { backgroundColor: ACCENT }]}>
                          <Text variant="monoSmall" style={styles.savePillText}>
                            save {savings}%
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text variant="monoSmall" color="faint">
                      {PACKAGE_SUBLABELS[pkg.packageType] ?? ''}
                    </Text>
                  </View>
                  <Text variant="bodyMedium" style={styles.planPrice}>
                    {pkg.product.priceString}
                  </Text>
                </Pressable>
              );
            })}

            <Button
              label={busy ? 'One moment…' : selected ? `Go Plus · ${selected.product.priceString}` : 'Go Plus'}
              variant="primary"
              size="lg"
              fullWidth
              disabled={busy || !selected}
              onPress={() => selected && void purchase(selected)}
            />

            <Pressable onPress={() => void restore()} hitSlop={10}>
              <Text variant="mono" color="muted" style={styles.restore}>
                restore purchases
              </Text>
            </Pressable>
          </View>
        )}

        {usage.length > 0 && plan === 'FREE' ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text variant="mono" color="muted" style={styles.metersTitle}>
              your usage this cycle
            </Text>
            {usage.map((meter) => {
              const frac = meter.limit > 0 ? Math.min(1, meter.used / meter.limit) : 0;
              const maxed = meter.used >= meter.limit;
              return (
                <View key={meter.kind} style={styles.meter}>
                  <View style={styles.meterRow}>
                    <Text variant="caption" color="secondary">
                      {METER_LABELS[meter.kind]}
                    </Text>
                    <Text variant="monoSmall" color={maxed ? 'primary' : 'faint'}>
                      {meter.used}/{meter.limit}
                    </Text>
                  </View>
                  <View style={[styles.meterTrack, { backgroundColor: c.elevated }]}>
                    <View
                      style={[
                        styles.meterFill,
                        { width: `${Math.round(frac * 100)}%`, backgroundColor: maxed ? c.danger : ACCENT },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
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

  hero: { gap: Spacing[3], marginBottom: Spacing[1] },
  heroTitle: { lineHeight: 40 },
  lede: { lineHeight: 24 },

  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    gap: Spacing[3],
  },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  check: {
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: { flex: 1 },

  statusCard: { gap: Spacing[2] },
  statusBody: { lineHeight: 23 },
  status: { textAlign: 'center' },

  buttons: { gap: Spacing[3] },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[4],
  },
  planCardOn: { borderWidth: 2, paddingHorizontal: Spacing[4] - 1, paddingVertical: Spacing[4] - 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: Radius.full },
  planText: { flex: 1, gap: 2 },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  savePill: { borderRadius: Radius.full, paddingHorizontal: Spacing[2], paddingVertical: 2 },
  savePillText: { color: '#fff', fontSize: 10 },
  planPrice: {},

  restore: { fontSize: 11, textAlign: 'center', marginTop: Spacing[2] },

  metersTitle: { fontSize: 11 },
  meter: { gap: Spacing[2] },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meterTrack: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: Radius.full, minWidth: 3 },
});
