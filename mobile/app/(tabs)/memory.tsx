import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { FolderGrid } from '@/components/archive/FolderGrid';
import type { ArchiveFolderSummary } from '@/types/api';

type SortKey = 'recent' | 'alphabetical' | 'largest' | 'smallest';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'recent' },
  { key: 'alphabetical', label: 'a–z' },
  { key: 'largest', label: 'largest' },
  { key: 'smallest', label: 'smallest' },
];

function sortFolders(folders: ArchiveFolderSummary[], sort: SortKey): ArchiveFolderSummary[] {
  const copy = [...folders];
  switch (sort) {
    case 'alphabetical':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'largest':
      return copy.sort((a, b) => b.count - a.count);
    case 'smallest':
      return copy.sort((a, b) => a.count - b.count);
    case 'recent':
    default:
      return copy.sort((a, b) => b.latestActivity.localeCompare(a.latestActivity));
  }
}

export default function ArchiveScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [infoVisible, setInfoVisible] = useState(false);
  const [sort, setSort] = useState<SortKey>('recent');

  const { data, loading, refetch } = useApiQuery(() => api.archive.list(), []);
  const folders = data?.folders ?? null;

  // Pull-to-refresh only — focus revalidation stays silent so switching to
  // this tab doesn't flash a spinner over data that's already on screen.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  // Refresh when the tab regains focus so the archive never shows stale entries.
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const sortedFolders = useMemo(() => (folders ? sortFolders(folders, sort) : []), [folders, sort]);
  const isEmpty = !loading && (folders?.length ?? 0) === 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark" color="primary">archive</Text>
        <View style={styles.headerRight}>
          {folders && folders.length > 0 && (
            <Text variant="monoSmall" style={{ color: c.faint, fontFamily: FontFamily.mono, marginRight: Spacing[3] }}>
              {folders.length}
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
        body="Everything you've saved, organized into folders by topic. Open a folder to browse its entries — and its sub-topics, if it has any."
      />

      {folders && folders.length > 0 && (
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map((opt) => {
            const selected = sort === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setSort(opt.key)}
                style={[
                  styles.sortPill,
                  { borderColor: selected ? c.inverse : c.border },
                  selected && { backgroundColor: c.inverse },
                ]}
              >
                <Text variant="monoSmall" color={selected ? 'inverse' : 'secondary'}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={c.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading && !folders && (
          <AsciiLoader
            variant="cat"
            size={80}
            message={['opening the stacks…', 'sorting your folders…', 'shooing dust bunnies…']}
          />
        )}

        {isEmpty && (
          <ScreenIntro
            title="Nothing here yet"
            body="Capture something from the map and it'll show up here, organized into folders by topic."
          />
        )}

        <FolderGrid folders={sortedFolders} />
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
  sortRow: {
    flexDirection: 'row',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
  },
  sortPill: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
  },
  content: { paddingHorizontal: Spacing[4], paddingBottom: Spacing[16] },
});
