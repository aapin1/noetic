import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Accents, FontFamily, FontSize, Radius, Spacing, accentForKey } from '@/constants/theme';
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

const VIEW_ACCENT = Accents.slate;
const SORT_ACCENT = Accents.amber;

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
    <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
      {/* A dark chrome band, the way the Atlas wears its wordmark on the map.
          The safe-area strip above takes the same colour, so the notch region
          reads as part of the header rather than as a pale sliver over it. */}
      <View style={[styles.header, { borderBottomColor: c.deepBorder, backgroundColor: c.deep }]}>
        <Text variant="wordmark" style={{ color: c.deepInk }}>archive</Text>
        <View style={styles.headerRight}>
          {folders && folders.length > 0 && (
            <Text variant="monoSmall" style={{ color: c.deepInkFaint, fontFamily: FontFamily.mono, marginRight: Spacing[3] }}>
              {folders.length}
            </Text>
          )}
          <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About archive">
            <Text style={{ color: c.deepInkFaint, fontSize: 16 }}>ⓘ</Text>
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
          {/* A recessed field, not a dark one. `elevated` is the tint the app
              uses everywhere for "pressed into the page"; near-black here read
              as a second header stacked under the first. */}
          <View style={[styles.searchBox, { borderColor: c.border, backgroundColor: c.elevated }]}>
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
                <Text style={{ color: c.muted, fontSize: 14 }}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {!searchActive && folders && folders.length > 0 && (
        <View style={styles.sortRow}>
          {/* Selected pills are tinted, not filled with `inverse`. `inverse` is
              a near-black in light mode, so this row put two or three dark
              slabs directly under the dark header band — the same colour doing
              two different jobs a few pixels apart. The tint is the topic-badge
              recipe, which is what the rest of the app uses to say "this one".
              Dark on this screen belongs to the header and nowhere else. */}
          {/* View toggle: topical folders vs the chronological diary. */}
          {(['diary', 'folders'] as ViewKey[]).map((v) => {
            const selected = view === v;
            return (
              <Pressable
                key={v}
                onPress={() => setView(v)}
                style={[
                  styles.sortPill,
                  { borderColor: selected ? `${VIEW_ACCENT}66` : c.border },
                  selected && { backgroundColor: `${VIEW_ACCENT}1F` },
                ]}
                accessibilityRole="button"
                accessibilityLabel={v === 'diary' ? 'Show diary view' : 'Show folder view'}
              >
                <Text variant="monoSmall" style={selected ? { color: VIEW_ACCENT } : undefined} color="secondary">
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
                      { borderColor: selected ? `${SORT_ACCENT}66` : c.border },
                      selected && { backgroundColor: `${SORT_ACCENT}1F` },
                    ]}
                  >
                    <Text variant="monoSmall" style={selected ? { color: SORT_ACCENT } : undefined} color="secondary">
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
        style={{ backgroundColor: c.canvas }}
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
            {(searchResults ?? []).map((item) => {
              const topic = item.topics[0] ?? null;
              const accent = topic ? accentForKey(topic.topicId) : null;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => router.push(`/insight/${item.id}` as never)}
                  style={[styles.resultRow, { borderColor: c.border, backgroundColor: c.surface }]}
                  accessibilityRole="button"
                >
                  <Text variant="bodyMedium" numberOfLines={2}>{item.title}</Text>
                  <View style={styles.resultMeta}>
                    {topic ? (
                      <View style={styles.resultTopic}>
                        <View style={[styles.topicDot, { backgroundColor: accent! }]} />
                        <Text variant="monoSmall" color="muted" numberOfLines={1}>
                          {topic.name}
                        </Text>
                      </View>
                    ) : <View />}
                    <Text variant="monoSmall" color="muted">
                      {new Date(item.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
