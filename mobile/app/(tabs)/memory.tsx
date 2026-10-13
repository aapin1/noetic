import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowUpDownIcon, InfoIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { shortDate } from '@/lib/dates';
import { Radius, Spacing, accentForKey } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import { SearchField } from '@/components/ui/SearchField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { FolderGrid } from '@/components/archive/FolderGrid';
import { DiaryList } from '@/components/archive/DiaryList';
import type { ArchiveFolderSummary, CaptureSummary } from '@/types/api';

type ViewKey = 'folders' | 'diary';
type SortKey = 'recent' | 'alphabetical' | 'largest' | 'smallest';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'alphabetical', label: 'A to Z' },
  { key: 'largest', label: 'Largest' },
  { key: 'smallest', label: 'Smallest' },
];

const VIEW_OPTIONS: { key: ViewKey; label: string }[] = [
  { key: 'diary', label: 'Diary' },
  { key: 'folders', label: 'Folders' },
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
  const [view, setView] = useState<ViewKey>('diary');
  const [sort, setSort] = useState<SortKey>('recent');
  // Bumped on pull-to-refresh so the diary re-reads its first page too.
  const [diaryRefreshToken, setDiaryRefreshToken] = useState(0);

  const { data, loading, refetch } = useApiQuery(() => api.archive.list(), [], { cacheKey: 'archive.list' });
  const folders = data?.folders ?? null;

  // Pull-to-refresh only — focus revalidation stays silent so switching to
  // this tab doesn't flash a spinner over data that's already on screen.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setDiaryRefreshToken((t) => t + 1);
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

  // Sorting is a secondary choice: an action sheet on iOS; elsewhere the
  // control steps to the next option on each tap.
  const sortLabel = SORT_OPTIONS.find((o) => o.key === sort)!.label;
  const chooseSort = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...SORT_OPTIONS.map((o) => o.label), 'Cancel'],
          cancelButtonIndex: SORT_OPTIONS.length,
          title: 'Sort folders',
        },
        (index) => {
          const opt = SORT_OPTIONS[index];
          if (opt) setSort(opt.key);
        },
      );
      return;
    }
    setSort((current) => {
      const i = SORT_OPTIONS.findIndex((o) => o.key === current);
      return SORT_OPTIONS[(i + 1) % SORT_OPTIONS.length]!.key;
    });
  }, []);

  // Full-text search across everything ever saved — the folders are browsing,
  // this is retrieval. Debounced against the captures list endpoint.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CaptureSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = text.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await api.captures.list({ query: q, limit: 40 });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }, []);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const searchActive = searchQuery.trim().length > 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
      {/* A dark chrome band, the way the Atlas wears its wordmark on the map.
          The safe-area strip above takes the same colour, so the notch region
          reads as part of the header rather than as a pale sliver over it. */}
      <View style={[styles.header, { borderBottomColor: c.deepBorder, backgroundColor: c.deep }]}>
        <Text variant="headline" style={{ color: c.deepInk }}>Archive</Text>
        <View style={styles.headerRight}>
          {folders && folders.length > 0 && (
            <Text variant="caption" style={{ color: c.deepInkMuted, marginRight: Spacing[3] }}>
              {folders.length}
            </Text>
          )}
          <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About Archive" accessibilityRole="button">
            <InfoIcon size={20} color={c.deepInkMuted} />
          </Pressable>
        </View>
      </View>
      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="About Archive"
        body="Everything you've saved. Folders organize it by topic; the diary lists it day by day, newest first. Open anything to revisit its insight."
      />

      {/* The page proper. The safe-area container above is `deep` so the notch
          strip matches the header band; without this the search field and the
          controls sat on that same dark ground, which spread the header's
          colour halfway down the screen. Dark belongs to the title bar only —
          the same split Pulse and You use. */}
      <View style={[styles.body, { backgroundColor: c.canvas }]}>
      {(folders?.length ?? 0) > 0 && (
        <View style={styles.searchWrap}>
          <SearchField
            value={searchQuery}
            onChangeText={handleSearchChange}
            busy={searching}
            placeholder="Search your saves"
            accessibilityLabel="Search your captures"
          />
        </View>
      )}

      {!searchActive && folders && folders.length > 0 && (
        <View style={styles.controls}>
          <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} style={styles.segmented} />
          {view === 'folders' && (
            <Pressable
              onPress={chooseSort}
              hitSlop={8}
              style={styles.sortButton}
              accessibilityRole="button"
              accessibilityLabel={`Sort folders, currently ${sortLabel}`}
            >
              <ArrowUpDownIcon size={16} color={c.textSecondary} />
              <Text variant="caption" color="secondary">{sortLabel}</Text>
            </Pressable>
          )}
        </View>
      )}

      <ScrollView
        style={{ backgroundColor: c.canvas }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={c.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        {isEmpty && (
          <ScreenIntro
            art="folder"
            title="Every save, filed"
            body="Archive keeps everything you capture as a day-by-day diary and topic folders, with search through all of it. Save one thing on the atlas and it appears here."
            actions={[
              { label: 'Save your first thing', onPress: () => router.push('/(tabs)' as never) },
              { label: 'Import your saves', onPress: () => router.push('/import' as never) },
            ]}
          />
        )}

        {searchActive ? (
          <View style={styles.resultsWrap}>
            {searchResults !== null && searchResults.length === 0 && !searching && (
              <Text variant="caption" color="muted" style={styles.noResults}>
                No results
              </Text>
            )}
            {(searchResults ?? []).map((item) => {
              const topic = item.topics[0] ?? null;
              const accent = topic ? accentForKey(topic.topicId) : null;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => router.push(`/insight/${item.id}?from=archive` as never)}
                  style={[styles.resultRow, { borderColor: c.border, backgroundColor: c.surface }]}
                  accessibilityRole="button"
                >
                  <Text variant="bodyMedium" numberOfLines={2}>{item.title}</Text>
                  <View style={styles.resultMeta}>
                    {topic ? (
                      <View style={styles.resultTopic}>
                        <View style={[styles.topicDot, { backgroundColor: accent! }]} />
                        <Text variant="caption" color="muted" numberOfLines={1}>
                          {topic.name}
                        </Text>
                      </View>
                    ) : <View />}
                    <Text variant="caption" color="muted">
                      {shortDate(item.capturedAt)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : view === 'diary' ? (
          <DiaryList refreshToken={diaryRefreshToken} />
        ) : (
          <FolderGrid folders={sortedFolders} />
        )}
      </ScrollView>
      </View>
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
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: { flex: 1 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[3],
  },
  segmented: { flex: 1 },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    paddingVertical: Spacing[1],
  },
  content: { paddingHorizontal: Spacing[4], paddingBottom: Spacing[16] },
  searchWrap: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
  },
  resultsWrap: { paddingHorizontal: Spacing[2], paddingTop: Spacing[3] },
  noResults: { textAlign: 'center', paddingTop: Spacing[8] },
  resultRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
    marginBottom: Spacing[3],
  },
  resultTopic: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  topicDot: { width: 6, height: 6, borderRadius: 3, marginRight: Spacing[2] },
  resultMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing[2],
    gap: Spacing[3],
  },
});
