import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { dayLabel } from '@/lib/dates';
import { Radius, Spacing, accentForKey } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { SponsoredCard } from '@/components/ui/SponsoredCard';
import type { CaptureKind, CaptureSummary } from '@/types/api';

const PAGE_SIZE = 50;
/**
 * How many ad slots the diary will ever mount. Each slot is its own ad
 * request, so an uncapped every-other-day cadence would fire dozens of them on
 * a long history — slow, and AdMob starts no-filling a unit hit that hard.
 * Four covers the stretch anyone actually scrolls in one sitting.
 */
const MAX_DIARY_ADS = 4;
/**
 * Ads sit between day headers: one after the most recent day (index 0), then
 * every fourth day after that — always with a following day, so an ad never
 * dangles at the very end of the diary.
 */
function showAdAfterDay(groupIndex: number, groupCount: number): boolean {
  if (groupIndex % 4 !== 0 || groupIndex >= groupCount - 1) return false;
  return groupIndex / 4 < MAX_DIARY_ADS;
}

const KIND_LABEL: Record<CaptureKind, string> = {
  LINK: 'Link',
  TEXT: 'Note',
  QUOTE: 'Quote',
  IMAGE: 'Image',
};

/** One line of provenance under the title: author, or source, or the kind. */
function subline(item: CaptureSummary): string {
  const author = item.contentItem?.authorName?.trim();
  if (author) return `by ${author}`;
  const source = item.contentItem?.sourceName?.trim();
  if (source) return source;
  return KIND_LABEL[item.kind] ?? item.kind;
}

/** The calendar day an entry belongs to, for grouping. */
function dayKey(iso: string): string {
  return new Date(iso).toDateString();
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
    const out: { key: string; label: string; entries: CaptureSummary[] }[] = [];
    for (const item of items) {
      const key = dayKey(item.capturedAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.entries.push(item);
      else out.push({ key, label: dayLabel(item.capturedAt), entries: [item] });
    }
    return out;
  }, [items]);

  if (error && !items) {
    return (
      <Text variant="caption" color="danger" style={styles.status}>{error}</Text>
    );
  }

  if (!items) {
    return <AsciiLoader variant="cat" size={80} message="Loading your diary" />;
  }

  // No empty message here: the Archive screen already renders its own
  // "Nothing here yet" intro directly above this list, and the two stacked
  // read as the same thing said twice.
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {groups.map((group, gi) => (
        <View key={group.key}>
          <Text variant="headline" style={styles.dayHeader}>
            {group.label}
          </Text>
          {/* Each day is a leaf of paper, not a run of rules on the page. The
              diary was type on a flat field with hairlines between entries —
              nothing to tell one day from the next except a caption. */}
          <View style={[styles.day, { backgroundColor: c.surface, borderColor: c.border }]}>
            {group.entries.map((item, i) => {
              const topic = item.topics[0] ?? null;
              const accent = topic ? accentForKey(topic.topicId) : null;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => router.push(`/insight/${item.id}?from=archive` as never)}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSubtle },
                  ]}
                  accessibilityRole="button"
                >
                  <Text variant="serif" color="primary" numberOfLines={2}>{item.title}</Text>
                  <View style={styles.rowSub}>
                    {!!accent && <View style={[styles.topicDot, { backgroundColor: accent }]} />}
                    <Text variant="caption" color="muted" numberOfLines={1} style={styles.rowSubText}>
                      {subline(item)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {showAdAfterDay(gi, groups.length) ? <SponsoredCard /> : null}
        </View>
      ))}
      {!done && (
        <Button
          label="Load earlier"
          variant="secondary"
          size="sm"
          onPress={() => void loadMore()}
          loading={loadingMore}
          accessibilityLabel="Load earlier entries"
          style={styles.moreBtn}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing[2], paddingTop: Spacing[2] },
  status: { textAlign: 'center', paddingTop: Spacing[8] },
  dayHeader: {
    marginTop: Spacing[6],
    marginBottom: Spacing[2],
  },
  day: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[4],
    overflow: 'hidden',
  },
  row: {
    paddingVertical: Spacing[4],
  },
  rowSub: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing[1],
  },
  topicDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: Spacing[2],
  },
  rowSubText: { flex: 1 },
  moreBtn: {
    marginTop: Spacing[6],
    alignSelf: 'center',
  },
});
