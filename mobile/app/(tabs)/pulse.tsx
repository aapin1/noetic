import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
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
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import { MiniMap } from '@/components/MiniMap';
import type { PulseFriend, PulseLatestItem } from '@/types/api';

const CARD_W = Dimensions.get('window').width - Spacing[6] * 2;

function LatestRow({ item }: { item: PulseLatestItem }) {
  const c = useThemeColors();
  const date = new Date(item.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const normalizedTitle = (item.title ?? '').trim().toLowerCase();
  const showKeyIdea = !!item.keyIdea && item.keyIdea.trim().toLowerCase() !== normalizedTitle;

  return (
    <View style={[styles.latestRow, { borderTopColor: c.borderSubtle }]}>
      <View style={styles.latestMeta}>
        <Text variant="monoSmall" style={{ color: c.muted }}>{item.kind.toLowerCase()}</Text>
        <Text variant="monoSmall" style={{ color: c.faint }}>{date}</Text>
      </View>
      <Text variant="serif" color="primary" numberOfLines={2} style={styles.latestTitle}>
        {item.title}
      </Text>
      {showKeyIdea && (
        <Text variant="monoSmall" color="muted" numberOfLines={2} style={styles.latestIdea}>
          {item.keyIdea}
        </Text>
      )}
    </View>
  );
}

function FriendCard({
  friend,
  onUnfollow,
}: {
  friend: PulseFriend;
  onUnfollow: (id: string) => void;
}) {
  const c = useThemeColors();
  const { user, map, latest } = friend;
  const topRegions = [...map.clusters]
    .filter((cl) => cl.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((cl) => cl.name)
    .join(' · ');

  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.cardHeader}>
        <Avatar uri={user.avatarUrl} displayName={user.displayName} size="sm" />
        <View style={styles.cardMeta}>
          <Text variant="bodyMedium" numberOfLines={1}>{user.displayName}</Text>
          <Text variant="monoSmall" style={{ color: c.faint }} numberOfLines={1}>@{user.handle}</Text>
        </View>
        <Pressable onPress={() => onUnfollow(user.id)} hitSlop={8} style={[styles.unfollowBtn, { borderColor: c.faint }]}>
          <Text variant="monoSmall" style={{ color: c.faint }}>following</Text>
        </Pressable>
      </View>

      {!!user.identitySummary && (
        <Text variant="monoSmall" color="muted" numberOfLines={2} style={styles.identity}>
          {user.identitySummary}
        </Text>
      )}

      {map.nodes.length > 0 ? (
        <View style={styles.mapWrap}>
          <MiniMap nodes={map.nodes} clusters={map.clusters} width={CARD_W - Spacing[5] * 2} />
          {!!topRegions && (
            <Text variant="monoSmall" style={[styles.regions, { color: c.faint }]} numberOfLines={1}>
              {topRegions}
            </Text>
          )}
        </View>
      ) : (
        <View style={[styles.emptyMap, { borderColor: c.borderSubtle }]}>
          <Text variant="monoSmall" style={{ color: c.faint }}>nothing on their map yet</Text>
        </View>
      )}

      {latest.length > 0 && (
        <View style={styles.latestSection}>
          <Text variant="monoSmall" style={[styles.latestLabel, { color: c.muted }]}>latest</Text>
          {latest.map((item) => (
            <LatestRow key={item.id} item={item} />
          ))}
        </View>
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

  const handleFollow = () => {
    if (followed) return;
    setFollowed(true);
    onFollow(user.id);
    void api.social.follow(user.id).catch(() => {
      // already following is fine
    });
  };

  return (
    <View style={[styles.userRow, { borderBottomColor: c.border }]}>
      <Avatar uri={user.avatarUrl} displayName={user.displayName} size="sm" />
      <View style={styles.userInfo}>
        <Text variant="bodyMedium">{user.displayName}</Text>
        <Text variant="monoSmall" style={{ color: c.muted }}>@{user.handle}</Text>
      </View>
      <Pressable
        onPress={handleFollow}
        disabled={followed}
        hitSlop={8}
        style={({ pressed }) => [
          styles.followBtn,
          { borderColor: followed ? c.faint : c.text },
          pressed && !followed && styles.followBtnPressed,
        ]}
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
  const [friends, setFriends] = useState<PulseFriend[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  const { data, loading, error, refetch } = useApiQuery(
    () => api.social.pulse(),
    [],
  );

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  useEffect(() => {
    if (data) setFriends(data.friends);
  }, [data]);

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

  const handleFollowed = useCallback(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchInputRef.current?.blur();
    setSearchQuery('');
    setSearchResults([]);
    void refetch();
  }, [refetch]);

  const handleUnfollow = useCallback(async (id: string) => {
    setFriends((prev) => prev.filter((f) => f.user.id !== id));
    try {
      await api.social.unfollow(id);
    } catch {
      // If it fails, the next refetch restores the true state.
      void refetch();
    }
  }, [refetch]);

  const isEmpty = !loading && !error && friends.length === 0 && !searchQuery.trim();

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
        body="Follow people by their handle and watch a small version of their map, and their latest logs, appear here. Search is always open at the top to find more."
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
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.searchWrap, { borderBottomColor: c.border }]}>
            <View style={[styles.searchBox, { borderColor: c.border }]}>
              <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.faint, marginRight: Spacing[2], letterSpacing: 1.5 }}>
                FIND_
              </Text>
              <TextInput
                ref={searchInputRef}
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

          {searchQuery.trim().length > 0 ? (
            <View>
              {searchResults.length === 0 && !searching && (
                <Text variant="monoSmall" style={{ color: c.faint, paddingHorizontal: Spacing[6], paddingTop: Spacing[4] }}>no results</Text>
              )}
              {searchResults.map((u) => (
                <UserResult key={u.id} user={u} onFollow={handleFollowed} />
              ))}
            </View>
          ) : (
            <>
              {isEmpty && (
                <ScreenIntro
                  title="The pulse is quiet"
                  body="Follow a few people and their maps and latest logs will show up here. Use the search above to find them by handle."
                />
              )}
              {friends.map((friend) => (
                <FriendCard key={friend.user.id} friend={friend} onUnfollow={handleUnfollow} />
              ))}
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
  card: {
    marginHorizontal: Spacing[6],
    marginTop: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  cardMeta: { flex: 1, gap: 2 },
  unfollowBtn: { borderWidth: 1, borderRadius: Radius.xs, paddingVertical: Spacing[1], paddingHorizontal: Spacing[2] },
  identity: { marginTop: Spacing[3], lineHeight: 18 },
  mapWrap: { marginTop: Spacing[4] },
  regions: { marginTop: Spacing[3], letterSpacing: 0.5 },
  emptyMap: {
    marginTop: Spacing[4], borderWidth: 1, borderRadius: Radius.md,
    paddingVertical: Spacing[8], alignItems: 'center',
  },
  latestSection: { marginTop: Spacing[5] },
  latestLabel: { textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: Spacing[1] },
  latestRow: { paddingTop: Spacing[3], marginTop: Spacing[1], borderTopWidth: StyleSheet.hairlineWidth },
  latestMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing[1] },
  latestTitle: { marginBottom: Spacing[1] },
  latestIdea: { opacity: 0.75 },
  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing[3],
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  userInfo: { flex: 1, gap: 2 },
  followBtn: { borderWidth: 1, borderRadius: Radius.xs, paddingVertical: Spacing[2], paddingHorizontal: Spacing[3] },
  followBtnPressed: { opacity: 0.5 },
  centered: { paddingTop: Spacing[12], alignItems: 'center', paddingHorizontal: Spacing[6] },
});
