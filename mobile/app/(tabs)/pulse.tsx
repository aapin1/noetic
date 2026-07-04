import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { InfoModal } from '@/components/ui/InfoModal';
import type { FeedItem } from '@/types/api';

function FeedCard({ item }: { item: FeedItem }) {
  const c = useThemeColors();
  const date = new Date(item.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const title = item.title ?? item.rawText?.slice(0, 120) ?? 'Untitled';
  const topicsText = item.topics.slice(0, 3).map((t) => t.name).join(' · ');

  return (
    <View style={[styles.card, { borderBottomColor: c.border }]}>
      <View style={styles.cardHeader}>
        <Avatar uri={item.author.avatarUrl} displayName={item.author.displayName} size="sm" />
        <View style={styles.cardMeta}>
          <Text variant="monoSmall" style={{ color: c.text }}>{item.author.displayName}</Text>
          <Text variant="monoSmall" style={{ color: c.faint }}>@{item.author.handle}  ·  {date}</Text>
        </View>
      </View>
      <Text variant="serif" color="primary" numberOfLines={3} style={styles.cardTitle}>{title}</Text>
      {!!item.keyIdea && (
        <Text variant="monoSmall" color="muted" numberOfLines={2} style={styles.cardIdea}>{item.keyIdea}</Text>
      )}
      {topicsText.length > 0 && (
        <Text variant="monoSmall" style={{ color: c.faint }} numberOfLines={1}>{topicsText}</Text>
      )}
    </View>
  );
}

function UserResult({
  user,
  onFollow,
}: {
  user: { id: string; handle: string; displayName: string; avatarUrl: string | null };
  onFollow: (id: string) => void;
}) {
  const c = useThemeColors();
  const [followed, setFollowed] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFollow = async () => {
    if (busy || followed) return;
    setBusy(true);
    try {
      await api.social.follow(user.id);
    } catch {
      // already following is fine
    } finally {
      setFollowed(true);
      setBusy(false);
      onFollow(user.id);
    }
  };

  return (
    <View style={[styles.userRow, { borderBottomColor: c.border }]}>
      <Avatar uri={user.avatarUrl} displayName={user.displayName} size="sm" />
      <View style={styles.userInfo}>
        <Text variant="bodyMedium">{user.displayName}</Text>
        <Text variant="monoSmall" style={{ color: c.muted }}>@{user.handle}</Text>
      </View>
      <Pressable
        onPress={() => void handleFollow()}
        disabled={busy || followed}
        style={[styles.followBtn, { borderColor: followed ? c.faint : c.text }]}
      >
        <Text variant="monoSmall" style={{ color: followed ? c.faint : c.text }}>
          {followed ? 'following' : 'follow'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function PulseScreen() {
  const c = useThemeColors();
  const [infoVisible, setInfoVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; handle: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [allItems, setAllItems] = useState<FeedItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, loading, error, refetch } = useApiQuery(
    () => api.social.feed({ limit: 20 }),
    [],
  );

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  React.useEffect(() => {
    if (data) {
      setAllItems(data.items);
      setCursor(data.nextCursor);
    }
  }, [data]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await api.social.feed({ cursor, limit: 20 });
      setAllItems((prev) => [...prev, ...more.items]);
      setCursor(more.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  const onScroll = useCallback(({ nativeEvent }: {
    nativeEvent: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } };
  }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 200) {
      void loadMore();
    }
  }, [loadMore]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.social.searchUsers(text.trim());
        setSearchResults(res.users);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const isEmpty = !loading && !error && allItems.length === 0 && !searchQuery;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark" color="primary">pulse</Text>
        <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About pulse">
          <Text style={{ color: c.faint, fontSize: 16 }}>ⓘ</Text>
        </Pressable>
      </View>
      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="pulse"
        body="See what people you follow are reading and thinking about. Pulse is a slow, quiet feed — no likes or comments, just the ideas people choose to preserve."
      />

      {loading && !data ? (
        <SkeletonCard />
      ) : error ? (
        <View style={styles.centered}>
          <Text variant="monoSmall" style={{ color: c.muted }}>pulse unavailable</Text>
          <Pressable onPress={() => void refetch()} style={{ marginTop: Spacing[4] }}>
            <Text variant="monoSmall" style={{ color: c.text }}>retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refetch()} tintColor={c.text} />}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={200}
        >
          <View style={[styles.searchWrap, { borderBottomColor: c.border }]}>
            <View style={[styles.searchBox, { borderColor: c.border }]}>
              <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.faint, marginRight: Spacing[2], letterSpacing: 1.5 }}>
                FIND_
              </Text>
              <TextInput
                style={{ flex: 1, fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: c.text, paddingVertical: 0 }}
                value={searchQuery}
                onChangeText={handleSearchChange}
                placeholder="find people by handle..."
                placeholderTextColor={c.faint}
                autoCapitalize="none"
              />
              {searching && <ActivityIndicator size="small" color={c.muted} />}
            </View>
          </View>

          {searchQuery.trim().length > 0 && (
            <View>
              {searchResults.length === 0 && !searching && (
                <Text variant="monoSmall" style={{ color: c.faint, paddingHorizontal: Spacing[6], paddingTop: Spacing[4] }}>no results</Text>
              )}
              {searchResults.map((u) => (
                <UserResult key={u.id} user={u} onFollow={() => void refetch()} />
              ))}
            </View>
          )}

          {!searchQuery.trim() && (
            <>
              {isEmpty && (
                <View style={styles.emptyWrap}>
                  <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[4] }}>· · ·</Text>
                  <Text variant="serif" color="primary" style={{ marginBottom: Spacing[4] }}>the pulse is quiet</Text>
                  <Text variant="monoSmall" style={{ color: c.muted, textAlign: 'center', lineHeight: 22 }}>
                    {'Follow people to see their captures here.\nUse the search above to find them.'}
                  </Text>
                </View>
              )}
              {allItems.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
              {loadingMore && (
                <View style={{ paddingVertical: Spacing[6], alignItems: 'center' }}>
                  <ActivityIndicator color={c.muted} />
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: { paddingBottom: Spacing[16] },
  searchWrap: { paddingHorizontal: Spacing[6], paddingVertical: Spacing[4], borderBottomWidth: StyleSheet.hairlineWidth },
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: Radius.full,
    paddingHorizontal: Spacing[4], paddingVertical: 8,
  },
  card: { paddingHorizontal: Spacing[6], paddingVertical: Spacing[5], borderBottomWidth: StyleSheet.hairlineWidth },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[3] },
  cardMeta: { flex: 1, gap: 2 },
  cardTitle: { marginBottom: Spacing[2] },
  cardIdea: { marginBottom: Spacing[2] },
  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  userInfo: { flex: 1, gap: 2 },
  followBtn: { borderWidth: 1, borderRadius: Radius.xs, paddingVertical: Spacing[2], paddingHorizontal: Spacing[3] },
  centered: { paddingTop: Spacing[12], alignItems: 'center', paddingHorizontal: Spacing[6] },
  emptyWrap: { paddingTop: Spacing[12], paddingHorizontal: Spacing[6], alignItems: 'center' },
});
