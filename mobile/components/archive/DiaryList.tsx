import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { SponsoredCard } from '@/components/ui/SponsoredCard';
import type { CaptureSummary } from '@/types/api';

const PAGE_SIZE = 50;
/**
 * Ads sit between day headers: one after the most recent day (index 0), then on
 * every third day after that — always with a following day, so an ad never
 * dangles at the very end of the diary.
 */
function showAdAfterDay(groupIndex: number, groupCount: number): boolean {
  return groupIndex % 3 === 0 && groupIndex < groupCount - 1;
}

/** "November 1" — with the year appended once entries leave the current year. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** One line of provenance under the title: author, or source, or the kind. */
function subline(item: CaptureSummary): string {
  const author = item.contentItem?.authorName?.trim();
  if (author) return `by ${author}`;
  const source = item.contentItem?.sourceName?.trim();
  if (source) return source;
  return item.kind.toLowerCase();
}

/**
 * The diary: everything ever logged, newest first, grouped under plain date
 * headers — the Letterboxd-style chronological record of what you've saved.
 * Pages through the full history with keyset pagination.
 */
export function DiaryList({ refreshToken }: { refreshToken: number }) {
  const c = useThemeColors();
  const router = useRouter();
  const [items, setItems] = useState<CaptureSummary[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    api.captures
      .list({ limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        setItems(page);
        setDone(page.length < PAGE_SIZE);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your diary.');
      });
    return () => { cancelled = true; };
  }, [refreshToken]);

  const loadMore = useCallback(async () => {
    if (!items || items.length === 0 || done || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.captures.list({ limit: PAGE_SIZE, cursor: items[items.length - 1]!.id });
      setItems((prev) => [...(prev ?? []), ...page]);
      setDone(page.length < PAGE_SIZE);
    } catch {
      // The button stays; the next tap retries.
    } finally {
      setLoadingMore(false);
    }
  }, [items, done, loadingMore]);

  // Group consecutive entries by day. Entries arrive newest-first, so each
  // group is one diary day.
  const groups = useMemo(() => {
    if (!items) return [];
    const out: { label: string; entries: CaptureSummary[] }[] = [];
    for (const item of items) {
      const label = dayLabel(item.capturedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(item);
      else out.push({ label, entries: [item] });
    }
    return out;
  }, [items]);

  if (error && !items) {
    return (
      <Text variant="monoSmall" color="danger" style={styles.status}>{error}</Text>
    );
  }

  if (!items) {
    return (
      <AsciiLoader
        variant="cat"
        size={80}
        message={['opening the diary…', 'leafing back through the days…']}
      />
    );
  }

  if (items.length === 0) {
    return (
      <Text variant="monoSmall" color="muted" style={styles.status}>
        nothing logged yet — your saves will line up here, day by day.
      </Text>
    );
  }

  return (
    <View style={styles.wrap}>
      {groups.map((group, gi) => (
        <View key={group.label}>
          <Text variant="monoSmall" style={[styles.dayHeader, { color: c.faint }]}>
            {group.label.toUpperCase()}
          </Text>
          {group.entries.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push(`/insight/${item.id}` as never)}
              style={[styles.row, { borderBottomColor: c.borderSubtle }]}
              accessibilityRole="button"
            >
              <Text variant="serif" color="primary" numberOfLines={2}>{item.title}</Text>
              <Text variant="monoSmall" color="muted" numberOfLines={1} style={styles.rowSub}>
                {subline(item)}
              </Text>
            </Pressable>
          ))}
          {showAdAfterDay(gi, groups.length) ? <SponsoredCard /> : null}
        </View>
      ))}
      {!done && (
        <Pressable
          onPress={() => void loadMore()}
          style={[styles.moreBtn, { borderColor: c.border }]}
          disabled={loadingMore}
          accessibilityRole="button"
          accessibilityLabel="Load earlier entries"
        >
          {loadingMore
            ? <LoadingDots size={4} />
            : <Text variant="monoSmall" color="muted">earlier ↓</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing[2], paddingTop: Spacing[2] },
  status: { textAlign: 'center', paddingTop: Spacing[8] },
  dayHeader: {
    fontFamily: FontFamily.mono,
    letterSpacing: 1.5,
    marginTop: Spacing[6],
    marginBottom: Spacing[2],
  },
  row: {
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  rowSub: { marginTop: Spacing[1] },
  moreBtn: {
    marginTop: Spacing[6],
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[3],
    minWidth: 120,
    alignItems: 'center',
  },
});
