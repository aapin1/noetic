import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing, accentForKey } from '@/constants/theme';
import { shortDate } from '@/lib/dates';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Button } from '@/components/ui/Button';
import { PersonWrapped } from '@/components/wrapped/PersonWrapped';
import type { CaptureKind, PersonCapture } from '@/types/api';

const KIND_LABELS: Record<CaptureKind, string> = {
  LINK: 'Link',
  TEXT: 'Note',
  QUOTE: 'Quote',
  IMAGE: 'Image',
};

function kindLabel(kind: CaptureKind): string {
  return KIND_LABELS[kind] ?? 'Note';
}

/** Stable per-person seed, so their topic bubbles settle the same way each visit. */
function seedFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * One capture in the person's history. Deliberately just the bibliography —
 * kind and date, the title, then author, source. What the person *thought*
 * about it (their key idea, their reaction) is theirs and never rendered here.
 * A tap opens the thing itself (person/capture/[captureId]), under the same rule.
 */
function CaptureRow({ item, onPress }: { item: PersonCapture; onPress: () => void }) {
  const c = useThemeColors();
  const detail = [item.author, item.source].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { borderTopColor: c.borderSubtle, opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.rowMeta}>
        <Text variant="caption" color="muted">{kindLabel(item.kind)}</Text>
        <Text variant="caption" color="faint">{shortDate(item.capturedAt)}</Text>
      </View>
      <Text variant="serif" color="primary" numberOfLines={2} style={styles.rowTitle}>
        {item.title}
      </Text>
      {!!detail && (
        <Text variant="caption" color="muted" numberOfLines={1} style={styles.rowDetail}>
          {detail}
        </Text>
      )}
    </Pressable>
  );
}

/** "120 followers": the number carries the weight, the word stays secondary. */
function FollowCount({ count, label, onPress }: { count: number; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${count} ${label}`}
      style={({ pressed }) => [styles.followCount, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text variant="subheadline" color="primary" style={styles.followNumber}>{count}</Text>
      <Text variant="subheadline" color="secondary">{label}</Text>
    </Pressable>
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
    captureCount?: string;
    regions?: string;
  }>();
  const id = params.id;

  const { data, loading, error, refetch } = useApiQuery(
    () => api.social.personCaptures(id),
    [id],
    { cacheKey: `social.person:${id}` },
  );

  // The portrait is a second, independent read: the capture list never waits
  // on it, and a failure just leaves the cards out.
  const { data: wrapped, refetch: refetchWrapped } = useApiQuery(
    () => api.social.personWrapped(id),
    [id],
    { cacheKey: `social.person.wrapped:${id}` },
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
      await Promise.all([refetch(), refetchWrapped()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchWrapped]);

  const handle = data?.user.handle ?? params.handle ?? '';
  const displayName = data?.user.displayName ?? params.displayName ?? '';
  const avatarUrl = data?.user.avatarUrl ?? (params.avatarUrl || null);
  const openCapture = useCallback(
    (captureId: string) =>
      router.push({ pathname: '/person/capture/[captureId]', params: { captureId, userId: id, handle } }),
    [router, id, handle],
  );
  const openFollows = useCallback(
    (list: 'followers' | 'following') =>
      router.push({ pathname: '/person/follows', params: { userId: id, handle, list } }),
    [router, id, handle],
  );
  const captureCount = data?.captureCount ?? Number(params.captureCount ?? 0);
  const stats = [
    `${captureCount} ${captureCount === 1 ? 'point' : 'points'}`,
    params.regions || null,
  ].filter(Boolean).join(', ');

  // Unfollowing or a block turns this page into a 404 — treat it as gone, not broken.
  if (error && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
        <ScreenHeader title={handle ? `@${handle}` : 'Person'} />
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
                <Text variant="subheadline" color="secondary" numberOfLines={1}>{stats}</Text>
              )}
            </View>
          </View>
          {/* Counts arrive with the first read rather than riding the nav
              params, so they appear once instead of flashing "0 followers". */}
          {typeof data?.followerCount === 'number' && (
            <View style={styles.follows}>
              <FollowCount count={data.followerCount} label={data.followerCount === 1 ? 'follower' : 'followers'} onPress={() => openFollows('followers')} />
              <FollowCount count={data.followingCount} label="following" onPress={() => openFollows('following')} />
            </View>
          )}
        </View>

        {wrapped && wrapped.totalCaptures > 0 && (
          <View style={styles.portrait}>
            <PersonWrapped
              stats={wrapped}
              name={displayName.split(' ')[0] || `@${handle}`}
              accent={accentForKey(id)}
              seed={seedFor(id)}
              onOpenCapture={openCapture}
            />
          </View>
        )}

        <View style={styles.list}>
          <Text variant="h4" style={styles.listLabel}>Captures</Text>
          {captures.map((item) => (
            <CaptureRow key={item.id} item={item} onPress={() => openCapture(item.id)} />
          ))}
          {loading && captures.length === 0 && (
            <View style={styles.centered}><LoadingDots /></View>
          )}
          {!loading && captures.length === 0 && (
            <Text variant="caption" color="faint" style={{ paddingTop: Spacing[4] }}>
              Nothing captured yet
            </Text>
          )}
          {nextCursor && (
            <View style={styles.moreBtn}>
              <Button label="Load more" variant="secondary" size="sm" loading={loadingMore} onPress={() => void loadMore()} />
            </View>
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
  follows: { flexDirection: 'row', gap: Spacing[5], marginTop: Spacing[4] },
  followCount: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  followNumber: { fontWeight: '600' },
  portrait: { paddingHorizontal: Spacing[4], paddingTop: Spacing[5] },
  list: { paddingHorizontal: Spacing[6], paddingTop: Spacing[5] },
  listLabel: { marginBottom: Spacing[1] },
  row: { paddingTop: Spacing[3], marginTop: Spacing[1], borderTopWidth: StyleSheet.hairlineWidth },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing[1] },
  rowTitle: { marginBottom: Spacing[1] },
  rowDetail: { opacity: 0.75 },
  moreBtn: { paddingVertical: Spacing[5], alignItems: 'center' },
  centered: { paddingVertical: Spacing[8], alignItems: 'center' },
});
