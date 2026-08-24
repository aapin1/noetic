import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing, accentForKey } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingDots } from '@/components/ui/LoadingDots';
import type { PersonCapture } from '@/types/api';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/**
 * One capture in the person's history. Deliberately just the bibliography —
 * kind and date, the title, then author · source. What the person *thought*
 * about it (their key idea, their reaction) is theirs and never rendered here.
 */
function CaptureRow({ item }: { item: PersonCapture }) {
  const c = useThemeColors();
  const detail = [item.author, item.source].filter(Boolean).join(' · ');

  return (
    <View style={[styles.row, { borderTopColor: c.borderSubtle }]}>
      <View style={styles.rowMeta}>
        <Text variant="monoSmall" style={{ color: c.muted }}>{item.kind.toLowerCase()}</Text>
        <Text variant="monoSmall" style={{ color: c.faint }}>{fmtDate(item.capturedAt)}</Text>
      </View>
      <Text variant="serif" color="primary" numberOfLines={2} style={styles.rowTitle}>
        {item.title}
      </Text>
      {!!detail && (
        <Text variant="monoSmall" color="muted" numberOfLines={1} style={styles.rowDetail}>
          {detail}
        </Text>
      )}
    </View>
  );
}

export default function PersonScreen() {
  const c = useThemeColors();
  const router = useRouter();
  // The pulse card sends the masthead along, so the page paints a recognizable
  // header the instant it opens and the capture list fills in underneath.
  const params = useLocalSearchParams<{
    id: string;
    handle?: string;
    displayName?: string;
    avatarUrl?: string;
    identitySummary?: string;
    captureCount?: string;
    regions?: string;
  }>();
  const id = params.id;

  const { data, loading, error, refetch } = useApiQuery(
    () => api.social.personCaptures(id),
    [id],
    { cacheKey: `social.person:${id}` },
  );

  // Pages past the first live outside the query cache: `extra` accumulates
  // them, and a refetch (which resets `data`) clears the accumulation too.
  const [extra, setExtra] = useState<PersonCapture[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    if (data) {
      setExtra([]);
      setNextCursor(data.nextCursor);
    }
  }, [data]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.social.personCaptures(id, nextCursor);
      setExtra((prev) => [...prev, ...page.captures]);
      setNextCursor(page.nextCursor);
    } catch {
      // Leave the button in place so the tap can be retried.
    } finally {
      setLoadingMore(false);
    }
  }, [id, nextCursor, loadingMore]);

  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const handle = data?.user.handle ?? params.handle ?? '';
  const displayName = data?.user.displayName ?? params.displayName ?? '';
  const avatarUrl = data?.user.avatarUrl ?? (params.avatarUrl || null);
  const identitySummary = data?.user.identitySummary ?? (params.identitySummary || null);
  const captureCount = data?.captureCount ?? Number(params.captureCount ?? 0);
  const stats = [
    `${captureCount} ${captureCount === 1 ? 'point' : 'points'}`,
    params.regions || null,
  ].filter(Boolean).join(' · ');

  // Unfollowing or a block turns this page into a 404 — treat it as gone, not broken.
  if (error && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
        <ScreenHeader title={handle ? `@${handle}` : 'person'} />
        <EmptyState title="Person not found" ctaLabel="Back" onCta={() => router.back()} />
      </SafeAreaView>
    );
  }

  const captures = [...(data?.captures ?? []), ...extra];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title={`@${handle}`} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onPullRefresh()} tintColor={c.text} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.masthead, { borderBottomColor: c.border }]}>
          <View style={[styles.mastAccent, { backgroundColor: accentForKey(id) }]} />
          <View style={styles.mastRow}>
            <Avatar uri={avatarUrl} displayName={displayName} size="md" />
            <View style={styles.mastMeta}>
              <Text variant="h3" numberOfLines={1}>{displayName}</Text>
              {!!stats && (
                <Text variant="monoSmall" color="muted" numberOfLines={1}>{stats}</Text>
              )}
            </View>
          </View>
          {!!identitySummary && (
            <Text variant="serif" color="muted" style={styles.identity}>
              {identitySummary}
            </Text>
          )}
        </View>

        <View style={styles.list}>
          <Text variant="monoSmall" style={[styles.listLabel, { color: c.faint }]}>captures</Text>
          {captures.map((item) => (
            <CaptureRow key={item.id} item={item} />
          ))}
          {loading && captures.length === 0 && (
            <View style={styles.centered}><LoadingDots /></View>
          )}
          {!loading && captures.length === 0 && (
            <Text variant="monoSmall" style={{ color: c.faint, paddingTop: Spacing[4] }}>
              nothing captured yet
            </Text>
          )}
          {nextCursor && (
            <Pressable onPress={() => void loadMore()} style={styles.moreBtn} disabled={loadingMore}>
              {loadingMore ? (
                <LoadingDots />
              ) : (
                <Text variant="monoSmall" style={{ color: c.text }}>more ↓</Text>
              )}
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: Spacing[16] },
  masthead: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  mastAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  mastRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  mastMeta: { flex: 1, gap: 2 },
  identity: { marginTop: Spacing[4] },
  list: { paddingHorizontal: Spacing[6], paddingTop: Spacing[5] },
  listLabel: { textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: Spacing[1] },
  row: { paddingTop: Spacing[3], marginTop: Spacing[1], borderTopWidth: StyleSheet.hairlineWidth },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing[1] },
  rowTitle: { marginBottom: Spacing[1] },
  rowDetail: { opacity: 0.75 },
  moreBtn: { paddingVertical: Spacing[5], alignItems: 'center' },
  centered: { paddingVertical: Spacing[8], alignItems: 'center' },
});
