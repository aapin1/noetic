import React, { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import type { CaptureSummary } from '@/types/api';

function CaptureRow({ item, onPress }: { item: CaptureSummary; onPress: () => void }) {
  const c = useThemeColors();
  const date = new Date(item.capturedAt);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // For links, split "Title | Source" so the source appears as a byline
  let displayTitle = item.title;
  let displaySource: string | null = null;
  if (item.kind === 'LINK' && item.title) {
    const pipeIdx = item.title.lastIndexOf(' | ');
    if (pipeIdx > 0) {
      displayTitle = item.title.slice(0, pipeIdx);
      displaySource = item.title.slice(pipeIdx + 3);
    }
  }

  // Suppress keyIdea when it duplicates the full title
  const normalizedTitle = (item.title ?? '').trim().toLowerCase();
  const showKeyIdea =
    !!item.keyIdea && item.keyIdea.trim().toLowerCase() !== normalizedTitle;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderBottomColor: c.border }]}
      accessibilityRole="button"
    >
      <View style={styles.rowMeta}>
        <Text variant="monoSmall" style={{ color: c.muted }}>{item.kind.toLowerCase()}</Text>
        <Text variant="monoSmall" style={{ color: c.faint }}>{dateStr}</Text>
      </View>

      <Text variant="serif" color="primary" numberOfLines={2} style={styles.rowTitle}>
        {displayTitle}
      </Text>

      {!!displaySource && (
        <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[2] }} numberOfLines={1}>
          {displaySource}
        </Text>
      )}

      {showKeyIdea && (
        <Text variant="monoSmall" color="muted" numberOfLines={2} style={styles.rowIdea}>
          {item.keyIdea}
        </Text>
      )}

      {item.topics.length > 0 && (
        <View style={styles.topicRow}>
          {item.topics.slice(0, 4).map((t) => (
            <View key={t.topicId} style={[styles.topicChip, { borderColor: c.borderSubtle }]}>
              <Text variant="monoSmall" style={{ color: c.faint }}>
                {t.name}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!!item.leadInsight && (
        <Text variant="monoSmall" style={[styles.insightLine, { color: c.muted }]} numberOfLines={1}>
          {'↳ '}{item.leadInsight.headline}
        </Text>
      )}
    </Pressable>
  );
}

export default function LogScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [infoVisible, setInfoVisible] = useState(false);

  const { data: captures, loading, refetch } = useApiQuery(
    () => api.captures.list({ limit: 80 }),
    [],
  );

  const onRefresh = useCallback(() => void refetch(), [refetch]);

  // Refresh when the tab regains focus so the archive never shows stale entries.
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const isEmpty = !loading && (captures?.length ?? 0) === 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark" color="primary">log</Text>
        <View style={styles.headerRight}>
          {captures && captures.length > 0 && (
            <Text variant="monoSmall" style={{ color: c.faint, fontFamily: FontFamily.mono, marginRight: Spacing[3] }}>
              {captures.length}
            </Text>
          )}
          <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About archive">
            <Text style={{ color: c.faint, fontSize: 16 }}>ⓘ</Text>
          </Pressable>
        </View>
      </View>
      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="archive"
        body="A chronological record of everything you've saved: links, thoughts, and passages. Each entry shows its type, when it was captured, and the key idea Mneme pulled from it."
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading && !captures && (
          <View style={styles.loadingWrap}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.skeletonRow, { borderBottomColor: c.border }]}>
                <View style={[styles.skeletonLine, { width: '30%', backgroundColor: c.elevated }]} />
                <View style={[styles.skeletonLine, { width: '85%', backgroundColor: c.elevated, marginTop: 10 }]} />
                <View style={[styles.skeletonLine, { width: '60%', backgroundColor: c.elevated, marginTop: 6 }]} />
              </View>
            ))}
          </View>
        )}

        {isEmpty && (
          <View style={styles.emptyWrap}>
            <Text variant="monoSmall" style={{ color: c.muted, textAlign: 'center', letterSpacing: 1.5 }}>
              {'nothing here yet.\ncapture something from the map.'}
            </Text>
          </View>
        )}

        {captures?.map((item) => (
          <CaptureRow
            key={item.id}
            item={item}
            onPress={() => router.push(`/insight/${item.id}` as never)}
          />
        ))}
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: { paddingBottom: Spacing[16] },
  row: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[5],
    borderBottomWidth: 1,
  },
  rowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing[2],
  },
  rowTitle: { marginBottom: Spacing[2] },
  rowIdea: { marginBottom: Spacing[3], opacity: 0.75 },
  topicRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing[2] },
  topicChip: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: 2,
    paddingHorizontal: Spacing[2],
  },
  insightLine: { marginTop: Spacing[1] },
  loadingWrap: {},
  skeletonRow: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[5],
    borderBottomWidth: 1,
  },
  skeletonLine: { height: 12, borderRadius: Radius.xs },
  emptyWrap: {
    paddingTop: Spacing[20],
    alignItems: 'center',
  },
});
