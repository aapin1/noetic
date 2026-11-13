import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRightIcon } from 'lucide-react-native';

import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingDots } from '@/components/ui/LoadingDots';
import type { PersonFollow, PersonFollowsResponse } from '@/types/api';

type List = 'followers' | 'following';

const NO_USERS: PersonFollow[] = [];

const LIST_OPTIONS: { key: List; label: string }[] = [
  { key: 'followers', label: 'Followers' },
  { key: 'following', label: 'Following' },
];

/**
 * One person in the list. Person pages are followers-only, so a row only opens
 * one once you follow that account; until then the row is just the name and
 * the Follow button.
 */
function PersonRow({
  person,
  following,
  onToggle,
  onOpen,
}: {
  person: PersonFollow;
  following: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const c = useThemeColors();
  const openable = following && !person.isViewer;

  return (
    <Pressable
      onPress={openable ? onOpen : undefined}
      disabled={!openable}
      accessibilityRole={openable ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Avatar uri={person.avatarUrl} displayName={person.displayName} size="sm" />
      <View style={styles.rowInfo}>
        <Text variant="bodyMedium" numberOfLines={1}>{person.displayName}</Text>
        <Text variant="caption" color="muted" numberOfLines={1}>@{person.handle}</Text>
      </View>
      {person.isViewer ? (
        <Text variant="caption" color="muted">You</Text>
      ) : (
        <>
          <Button
            label={following ? 'Following' : 'Follow'}
            variant={following ? 'secondary' : 'primary'}
            size="sm"
            onPress={onToggle}
          />
          {openable && <ChevronRightIcon size={16} color={c.muted} />}
        </>
      )}
    </Pressable>
  );
}

export default function PersonFollowsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ userId: string; handle?: string; list?: List }>();
  const userId = params.userId;
  const [list, setList] = useState<List>(params.list === 'following' ? 'following' : 'followers');

  const { data, loading, error } = useApiQuery(
    () => api.social.personFollows(userId, list),
    [userId, list],
    { cacheKey: `social.person.follows:${userId}:${list}` },
  );

  // Pages past the first, tagged with the first page they continue. A fresh
  // read (or switching lists) replaces `data`, which orphans them for free.
  const [more, setMore] = useState<{
    base: PersonFollowsResponse;
    users: PersonFollow[];
    cursor: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const current = more && more.base === data ? more : null;
  const extra = current ? current.users : NO_USERS;
  const nextCursor = current ? current.cursor : data?.nextCursor ?? null;

  // Follows made on this screen, by id. They win over the server's answer
  // until the next read, so the button flips the instant it's tapped.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const toggle = useCallback(async (person: PersonFollow, nowFollowing: boolean) => {
    const next = !nowFollowing;
    setOverrides((prev) => ({ ...prev, [person.id]: next }));
    try {
      if (next) await api.social.follow(person.id);
      else await api.social.unfollow(person.id);
    } catch {
      // "Already following" lands here too, which still leaves you following;
      // anything else flips the button back.
      if (!next) setOverrides((prev) => ({ ...prev, [person.id]: true }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!data || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.social.personFollows(userId, list, nextCursor);
      setMore({ base: data, users: [...extra, ...page.users], cursor: page.nextCursor });
    } catch {
      // Leave the button in place so the tap can be retried.
    } finally {
      setLoadingMore(false);
    }
  }, [data, extra, userId, list, nextCursor, loadingMore]);

  const people = [...(data?.users ?? []), ...extra];
  const title = params.handle ? `@${params.handle}` : 'People';

  if (error && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
        <ScreenHeader title={title} />
        <EmptyState title="Person not found" ctaLabel="Back" onCta={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title={title} />
      <View style={styles.segmented}>
        <SegmentedControl options={LIST_OPTIONS} value={list} onChange={setList} />
      </View>

      <FlatList
        data={people}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => {
          const following = overrides[item.id] ?? item.viewerFollows;
          return (
            <PersonRow
              person={item}
              following={following}
              onToggle={() => void toggle(item, following)}
              onOpen={() =>
                router.push({
                  pathname: '/person/[id]',
                  params: {
                    id: item.id,
                    handle: item.handle,
                    displayName: item.displayName,
                    avatarUrl: item.avatarUrl ?? '',
                  },
                })
              }
            />
          );
        }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}><LoadingDots /></View>
          ) : (
            <Text variant="caption" color="faint" style={styles.empty}>
              {list === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
            </Text>
          )
        }
        ListFooterComponent={
          nextCursor ? (
            <View style={styles.moreBtn}>
              <Button label="Load more" variant="secondary" size="sm" loading={loadingMore} onPress={() => void loadMore()} />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  segmented: { paddingHorizontal: Spacing[6], paddingTop: Spacing[4], paddingBottom: Spacing[2] },
  content: { paddingBottom: Spacing[16] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowInfo: { flex: 1, gap: 2 },
  empty: { paddingHorizontal: Spacing[6], paddingTop: Spacing[6] },
  centered: { paddingVertical: Spacing[8], alignItems: 'center' },
  moreBtn: { paddingVertical: Spacing[5], alignItems: 'center' },
});
