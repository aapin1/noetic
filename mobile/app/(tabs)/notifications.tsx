import React, { useCallback } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { Notification } from '@/types/api';
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function notificationMessage(n: Notification): string {
  switch (n.type) {
    case 'FOLLOW': return 'started following you';
    case 'LIKE': return `liked your review of "${n.logEntry?.contentItem?.title ?? 'a piece'}"`;
    case 'COMMENT': return `commented on "${n.logEntry?.contentItem?.title ?? 'your review'}"`;
    case 'MENTION': return 'mentioned you';
    case 'RANKING_CHANGE': return `your ranking changed for "${n.contentItem?.title ?? 'a piece'}"`;
    case 'SIMILAR_USER': return 'has a similar taste profile to you';
    default: return 'interacted with you';
  }
}

function notificationTarget(n: Notification): string | null {
  if (n.type === 'FOLLOW' || n.type === 'SIMILAR_USER') return `/profile/${n.actor?.handle}`;
  if (n.logEntry) return `/content/${n.logEntry.contentItem?.id}`;
  if (n.contentItem) return `/content/${n.contentItem.id}`;
  return null;
}

function NotificationRow({ item }: { item: Notification }) {
  const router = useRouter();
  const target = notificationTarget(item);
  const timeAgo = (() => {
    const diff = Date.now() - new Date(item.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  })();

  return (
    <Pressable
      onPress={() => target && router.push(target as never)}
      style={[styles.row, !item.read && styles.rowUnread]}
      accessibilityRole="button"
      accessibilityLabel={`${item.actor?.displayName ?? 'Someone'} ${notificationMessage(item)}`}
    >
      <Avatar
        uri={item.actor?.avatarUrl}
        displayName={item.actor?.displayName}
        size="sm"
      />
      <View style={styles.rowText}>
        <Text variant="body">
          <Text variant="bodySemiBold">{item.actor?.displayName ?? 'Someone'}</Text>
          {' '}{notificationMessage(item)}
        </Text>
        <Text variant="monoSmall" color="muted" style={styles.time}>{timeAgo}</Text>
      </View>
      {!item.read && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const { data, loading, error, refetch } = useApiQuery(
    () => api.notifications.list(),
    [],
  );

  const notifications: Notification[] = data ?? [];

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const renderEmpty = () => {
    if (loading) {
      return (
        <View>
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </View>
      );
    }
    if (error) {
      return (
        <EmptyState
          title="Couldn't load activity"
          body="Check your connection and try again."
          ctaLabel="Retry"
          onCta={refetch}
        />
      );
    }
    return (
      <EmptyState
        title="No activity yet"
        body="When someone follows you, likes your review, or has a similar taste profile, it shows up here."
      />
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text
          style={{
            fontFamily: FontFamily.heading,
            fontSize: 18,
            color: Colors.primaryText,
            letterSpacing: 4,
          }}
        >
          Activity
        </Text>
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => <NotificationRow item={item} />}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={loading && notifications.length > 0}
            onRefresh={handleRefresh}
            tintColor={Colors.accentGold}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  list: { paddingBottom: Spacing[12] },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  rowUnread: {
    backgroundColor: Colors.surface,
  },
  rowText: { flex: 1 },
  time: { marginTop: 3 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accentGold,
    marginTop: 6,
  },
});
