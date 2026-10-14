import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { InfoIcon, MoreHorizontalIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { promptModerationActions } from '@/lib/moderation';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing, accentForKey } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { isAnonymousHandle } from '@/lib/disclosure';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { SearchField } from '@/components/ui/SearchField';
import { shortDate } from '@/lib/dates';
import { Whisper } from '@/components/ui/Whisper';
import { Avatar } from '@/components/ui/Avatar';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import { SponsoredCard } from '@/components/ui/SponsoredCard';
import { MiniMap } from '@/components/MiniMap';
import type { CaptureKind, PulseFriend, PulseLatestItem } from '@/types/api';

const CARD_W = Dimensions.get('window').width - Spacing[6] * 2;
/**
 * Slot one in-stream ad after the 1st friend card. It used to sit after the
 * 3rd, which meant anyone following fewer than four people never saw it — and
 * most people follow two or three.
 */
const AD_AFTER_FRIEND_INDEX = 0;

const KIND_LABELS: Record<CaptureKind, string> = {
  LINK: 'Link',
  TEXT: 'Note',
  QUOTE: 'Quote',
  IMAGE: 'Image',
};

function kindLabel(kind: CaptureKind): string {
  return KIND_LABELS[kind] ?? 'Note';
}

function LatestRow({ item }: { item: PulseLatestItem }) {
  const c = useThemeColors();
  const date = shortDate(item.capturedAt);
  const normalizedTitle = (item.title ?? '').trim().toLowerCase();
  const showKeyIdea = !!item.keyIdea && item.keyIdea.trim().toLowerCase() !== normalizedTitle;

  return (
    <View style={[styles.latestRow, { borderTopColor: c.borderSubtle }]}>
      <View style={styles.latestMeta}>
        <Text variant="caption" color="muted">{kindLabel(item.kind)}</Text>
        <Text variant="caption" color="faint">{date}</Text>
      </View>
      <Text variant="serif" color="primary" numberOfLines={2} style={styles.latestTitle}>
        {item.title}
      </Text>
      {showKeyIdea && (
        <Text variant="caption" color="muted" numberOfLines={2} style={styles.latestIdea}>
          {item.keyIdea}
        </Text>
      )}
    </View>
  );
}

function FriendCard({
  friend,
  onUnfollow,
  onBlocked,
}: {
  friend: PulseFriend;
  onUnfollow: (id: string) => void;
  onBlocked: () => void;
}) {
  const c = useThemeColors();
  const router = useRouter();
  const { user, map, latest, captureCount } = friend;
  const topRegions = [...map.clusters]
    .filter((cl) => cl.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((cl) => cl.name)
    .join(', ');

  // The same shape of summary the reader gets for their own map on Atlas, so a
  // friend's card is legible at a glance. Segments drop out when they'd be zero.
  const fieldCount = map.clusters.length;
  const stats = [
    `${captureCount} ${captureCount === 1 ? 'point' : 'points'}`,
    fieldCount > 0 ? `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}` : null,
  ].filter(Boolean).join(', ');

  // The whole card is the doorway to the person's page; the header buttons
  // (unfollow, report) sit on top and win their own taps. Header fields ride
  // along as params so the page paints its masthead before the fetch returns.
  const openPerson = () => {
    router.push({
      pathname: '/person/[id]',
      params: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? '',
        identitySummary: user.identitySummary ?? '',
        captureCount: String(captureCount),
        regions: topRegions,
      },
    } as never);
  };

  return (
    <Pressable
      onPress={openPerson}
      accessibilityRole="button"
      accessibilityLabel={`Open ${user.displayName}'s captures`}
      style={({ pressed }) => [
        styles.card,
        { borderColor: c.border, backgroundColor: c.surface },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={[styles.cardAccent, { backgroundColor: accentForKey(user.id) }]} />
      <View style={styles.cardHeader}>
        <Avatar uri={user.avatarUrl} displayName={user.displayName} size="sm" />
        <View style={styles.cardMeta}>
          <Text variant="bodyMedium" numberOfLines={1}>{user.displayName}</Text>
          <Text variant="caption" color="faint" numberOfLines={1}>@{user.handle}</Text>
        </View>
        <Button label="Following" variant="secondary" size="sm" onPress={() => onUnfollow(user.id)} />
        <Pressable
          onPress={() =>
            promptModerationActions({
              targetUserId: user.id,
              displayName: user.displayName,
              onChanged: onBlocked,
            })
          }
          hitSlop={10}
          style={styles.moreBtn}
          accessibilityRole="button"
          accessibilityLabel={`Report or block ${user.displayName}`}
        >
          <MoreHorizontalIcon size={18} color={c.faint} />
        </Pressable>
      </View>

      <Text variant="caption" color="muted" numberOfLines={1} style={styles.identity}>
        {stats}
      </Text>

      {map.nodes.length > 0 ? (
        <View style={styles.mapWrap}>
          <MiniMap
            nodes={map.nodes}
            edges={map.edges}
            clusters={map.clusters}
            width={CARD_W - Spacing[5] * 2}
          />
          {!!topRegions && (
            <Text variant="caption" color="faint" style={styles.regions} numberOfLines={1}>
              {topRegions}
            </Text>
          )}
        </View>
      ) : (
        <View style={[styles.emptyMap, { borderColor: c.borderSubtle }]}>
          <Text variant="caption" color="faint">Nothing on their map yet</Text>
        </View>
      )}

      {latest.length > 0 && (
        <View style={[styles.latestSection, { borderTopColor: c.border }]}>
          <Text variant="headline" style={styles.latestLabel}>Latest</Text>
          {latest.map((item) => (
            <LatestRow key={item.id} item={item} />
          ))}
        </View>
      )}
    </Pressable>
  );
}

type SearchUser = { id: string; handle: string; displayName: string; avatarUrl: string | null };

const SEARCH_DEBOUNCE_MS = 180;

function UserResult({
  user,
  onFollow,
  onBlocked,
}: {
  user: SearchUser;
  onFollow: (id: string) => void;
  onBlocked: () => void;
}) {
  const c = useThemeColors();
  const [followed, setFollowed] = useState(false);

  const handleFollow = async () => {
    if (followed) return;
    setFollowed(true);
    // The button flips instantly, but the parent's refetch must wait for the
    // follow to actually land — firing them together was a race the refetch
    // usually lost, so the new friend only appeared after a manual refresh.
    try {
      await api.social.follow(user.id);
    } catch {
      // "already following" lands here too; the refetch shows the truth either way.
    }
    onFollow(user.id);
  };

  return (
    <View style={[styles.userRow, { borderBottomColor: c.border }]}>
      <Avatar uri={user.avatarUrl} displayName={user.displayName} size="sm" />
      <View style={styles.userInfo}>
        <Text variant="bodyMedium">{user.displayName}</Text>
        <Text variant="caption" color="muted">@{user.handle}</Text>
      </View>
      <Button
        label={followed ? 'Following' : 'Follow'}
        variant={followed ? 'secondary' : 'primary'}
        size="sm"
        disabled={followed}
        onPress={() => void handleFollow()}
      />
      <Pressable
        onPress={() =>
          promptModerationActions({
            targetUserId: user.id,
            displayName: user.displayName,
            onChanged: onBlocked,
          })
        }
        hitSlop={10}
        style={styles.moreBtn}
        accessibilityRole="button"
        accessibilityLabel={`Report or block ${user.displayName}`}
      >
        <MoreHorizontalIcon size={18} color={c.faint} />
      </Pressable>
    </View>
  );
}

export default function PulseScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile } = useAuth();
  const [infoVisible, setInfoVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  // The query the results on screen actually belong to — lets us tell "found
  // nothing" apart from "haven't asked yet", so no result flashes prematurely.
  const [searchedFor, setSearchedFor] = useState('');
  const [searching, setSearching] = useState(false);
  const [friends, setFriends] = useState<PulseFriend[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transient "copied" flash on the empty state's handle action.
  const [handleCopied, setHandleCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const copyHandle = useCallback(async () => {
    if (!profile?.handle) return;
    await Clipboard.setStringAsync(`@${profile.handle}`);
    setHandleCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setHandleCopied(false), 2000);
  }, [profile?.handle]);
  const searchInputRef = useRef<TextInput>(null);
  // Monotonic counter: only the newest request may write to state, so a slow
  // reply for "a" can't land on top of the results for "aaron".
  const searchSeq = useRef(0);
  const searchCache = useRef(new Map<string, SearchUser[]>());

  const { data, loading, error, refetch } = useApiQuery(
    () => api.social.pulse(),
    [],
    { cacheKey: 'social.pulse' },
  );

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  // Pull-to-refresh only — focus revalidation stays silent so switching to
  // this tab doesn't flash a spinner over data that's already on screen.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  useEffect(() => {
    if (data) setFriends(data.friends);
  }, [data]);

  useEffect(() => () => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
  }, []);

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;

    // Backspacing back onto a query we already ran should be instant.
    const cached = searchCache.current.get(q.toLowerCase());
    if (cached) {
      searchSeq.current += 1;
      setSearchResults(cached);
      setSearchedFor(q);
      setSearching(false);
      return;
    }

    const seq = (searchSeq.current += 1);
    setSearching(true);
    try {
      const res = await api.social.searchUsers(q);
      if (seq !== searchSeq.current) return;
      searchCache.current.set(q.toLowerCase(), res.users);
      setSearchResults(res.users);
    } catch {
      if (seq !== searchSeq.current) return;
      setSearchResults([]);
    } finally {
      if (seq === searchSeq.current) {
        setSearchedFor(q);
        setSearching(false);
      }
    }
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text.trim()) {
      searchSeq.current += 1; // discard anything still in flight
      setSearchResults([]);
      setSearchedFor('');
      setSearching(false);
      return;
    }
    searchTimeout.current = setTimeout(() => { void runSearch(text); }, SEARCH_DEBOUNCE_MS);
  }, [runSearch]);

  const handleFollowed = useCallback(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchSeq.current += 1;
    searchInputRef.current?.blur();
    setSearchQuery('');
    setSearchResults([]);
    setSearchedFor('');
    setSearching(false);
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

  // A block removes the account from both the feed and any open search results,
  // so the person who just blocked someone doesn't keep looking at them.
  const handleBlocked = useCallback(() => {
    setSearchResults([]);
    setSearchedFor('');
    void refetch();
  }, [refetch]);

  const isEmpty = !loading && !error && friends.length === 0 && !searchQuery.trim();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
      {/* A dark chrome band, the way the Atlas wears its wordmark on the map.
          The safe-area strip above takes the same colour, so the notch region
          reads as part of the header rather than as a pale sliver over it. */}
      <View style={[styles.header, { borderBottomColor: c.deepBorder, backgroundColor: c.deep }]}>
        <Text variant="headline" style={{ color: c.deepInk }}>Pulse</Text>
        {/* First touch of the social surface: the one moment a generated
            handle is worth a line, since here it's about to be seen. */}
        <Whisper
          id="identity-claim"
          when={isAnonymousHandle(profile?.handle)}
          text={`You're @${profile?.handle ?? ''}. Make it yours?`}
          onPress={() => router.push('/profile/edit' as never)}
          style={{ flex: 1, alignItems: 'center' }}
        />
        <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="About Pulse">
          <InfoIcon size={20} color={c.deepInkFaint} />
        </Pressable>
      </View>
      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="About Pulse"
        body="Follow people by handle to see a small version of their map and their latest saves here. Use the search bar to find more people."
      />

      {/* The page proper. The safe-area container above is `deep` for the
          header band; this puts the paper back under the content. */}
      <View style={[styles.body, { backgroundColor: c.canvas }]}>
      {/* No loader on an unpopulated page — while the first read is in
          flight the page simply shows its (empty) layout. */}
      {error && !data ? (
        <View style={styles.centered}>
          <Text variant="h4">Pulse is unavailable</Text>
          <Button label="Try again" variant="secondary" size="sm" onPress={() => void refetch()} style={{ marginTop: Spacing[4] }} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onPullRefresh()} tintColor={c.text} />}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.searchWrap, { borderBottomColor: c.border }]}>
            <SearchField
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={handleSearchChange}
              busy={searching}
              placeholder="Search by handle"
            />
          </View>

          {searchQuery.trim().length > 0 ? (
            <View>
              {searchResults.length === 0 && !searching && searchedFor === searchQuery.trim() && (
                <Text variant="caption" color="faint" style={{ paddingHorizontal: Spacing[6], paddingTop: Spacing[4] }}>No results</Text>
              )}
              {searchResults.map((u) => (
                <UserResult key={u.id} user={u} onFollow={handleFollowed} onBlocked={handleBlocked} />
              ))}
            </View>
          ) : (
            <>
              {isEmpty && (
                <ScreenIntro
                  art="person"
                  title="Maps from people you know"
                  body="Pulse shows the maps and latest saves of people you follow. Search a handle above to find someone, or send a friend your handle so they can find you."
                  actions={[
                    {
                      label: handleCopied ? 'Copied' : 'Copy your handle',
                      onPress: () => void copyHandle(),
                    },
                  ]}
                />
              )}
              {friends.map((friend, i) => (
                <React.Fragment key={friend.user.id}>
                  <FriendCard friend={friend} onUnfollow={handleUnfollow} onBlocked={handleBlocked} />
                  {i === AD_AFTER_FRIEND_INDEX && friends.length > AD_AFTER_FRIEND_INDEX + 1 ? (
                    <SponsoredCard />
                  ) : null}
                </React.Fragment>
              ))}
            </>
          )}
        </ScrollView>
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1 },
  content: { paddingBottom: Spacing[16] },
  searchWrap: { paddingHorizontal: Spacing[6], paddingVertical: Spacing[4], borderBottomWidth: StyleSheet.hairlineWidth },
  card: {
    marginHorizontal: Spacing[6],
    marginTop: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    overflow: 'hidden',
  },
  // A hairline of the friend's accent down the leading edge. Deliberately not
  // a tinted card: six friends in six wash colours turns the feed into a
  // paint chart. One saturated edge is enough to tell the cards apart while
  // the surfaces stay the same paper.
  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  cardPressed: { opacity: 0.7 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  cardMeta: { flex: 1, gap: 2 },
  moreBtn: { paddingLeft: Spacing[2], paddingVertical: Spacing[1] },
  identity: { marginTop: Spacing[3], lineHeight: 18 },
  mapWrap: { marginTop: Spacing[4] },
  regions: { marginTop: Spacing[3] },
  emptyMap: {
    marginTop: Spacing[4], borderWidth: 1, borderRadius: Radius.md,
    paddingVertical: Spacing[8], alignItems: 'center',
  },
  latestSection: {
    marginTop: Spacing[5],
    borderTopWidth: 1,
    paddingTop: Spacing[4],
  },
  latestLabel: { marginBottom: Spacing[1] },
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
  centered: { paddingTop: Spacing[12], alignItems: 'center', paddingHorizontal: Spacing[6] },
});
