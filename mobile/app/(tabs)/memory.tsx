import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { FolderGrid } from '@/components/archive/FolderGrid';
import { DiaryList } from '@/components/archive/DiaryList';
import type { ArchiveFolderSummary, CaptureSummary } from '@/types/api';

type ViewKey = 'folders' | 'diary';
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
    <SafeAreaView style={[styles.safe, { backgroundColor: c.canvas }]} edges={['top']}>
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
        body="Everything you've saved. Folders organize it by topic; the diary lists it day by day, newest first. Open anything to revisit its insight."
      />

      {(folders?.length ?? 0) > 0 && (
        <View style={styles.searchWrap}>
          <View style={[styles.searchBox, { borderColor: c.border }]}>
            <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.faint, marginRight: Spacing[2], letterSpacing: 1.5 }}>
              FIND_
            </Text>
            <TextInput
              style={{ flex: 1, fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: c.text, paddingVertical: 0 }}
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder="search everything you've saved…"
              placeholderTextColor={c.faint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search your captures"
            />
            {searching ? (
              <LoadingDots size={4} />
            ) : searchActive ? (
              <Pressable onPress={() => handleSearchChange('')} hitSlop={10} accessibilityLabel="Clear search">
                <Text style={{ color: c.faint, fontSize: 14 }}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {!searchActive && folders && folders.length > 0 && (
        <View style={styles.sortRow}>
          {/* View toggle: topical folders vs the chronological diary. */}
          {(['diary', 'folders'] as ViewKey[]).map((v) => {
            const selected = view === v;
            return (
              <Pressable
                key={v}
                onPress={() => setView(v)}
                style={[
                  styles.sortPill,
                  { borderColor: selected ? c.inverse : c.border },
                  selected && { backgroundColor: c.inverse },
                ]}
                accessibilityRole="button"
                accessibilityLabel={v === 'diary' ? 'Show diary view' : 'Show folder view'}
              >
                <Text variant="monoSmall" color={selected ? 'inverse' : 'secondary'}>
                  {v}
                </Text>
              </Pressable>
            );
          })}
          {view === 'folders' && (
            <>
              <View style={[styles.sortDivider, { backgroundColor: c.border }]} />
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
            </>
          )}
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

        {searchActive ? (
          <View style={styles.resultsWrap}>
            {searchResults !== null && searchResults.length === 0 && !searching && (
              <Text variant="monoSmall" color="muted" style={styles.noResults}>
                nothing matches that.
              </Text>
            )}
            {(searchResults ?? []).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/insight/${item.id}` as never)}
                style={[styles.resultRow, { borderColor: c.border }]}
                accessibilityRole="button"
              >
                <Text variant="bodyMedium" numberOfLines={2}>{item.title}</Text>
                <View style={styles.resultMeta}>
                  {item.topics[0] ? (
                    <Text variant="monoSmall" color="muted" numberOfLines={1}>
                      {item.topics[0].name}
                    </Text>
                  ) : <View />}
                  <Text variant="monoSmall" color="muted">
                    {new Date(item.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : view === 'diary' ? (
          <DiaryList refreshToken={diaryRefreshToken} />
        ) : (
          <FolderGrid folders={sortedFolders} />
        )}
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
  },
  sortDivider: {
    width: 1,
    height: 16,
    marginHorizontal: Spacing[1],
  },
  sortPill: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
  },
  content: { paddingHorizontal: Spacing[4], paddingBottom: Spacing[16] },
  searchWrap: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[3],
  },
  resultsWrap: { paddingHorizontal: Spacing[2], paddingTop: Spacing[3] },
  noResults: { textAlign: 'center', paddingTop: Spacing[8] },
  resultRow: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[4],
    marginBottom: Spacing[3],
  },
  resultMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing[2],
    gap: Spacing[3],
  },
});
