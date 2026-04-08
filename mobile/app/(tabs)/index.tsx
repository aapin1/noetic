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
import { PlusIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { FeedItem } from '@/types/api';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import { FeedCard } from '@/components/feed/FeedCard';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';

const PAGE_SIZE = 20;

export default function FeedScreen() {
  const router = useRouter();
  const { data: feedItems, loading, error, refetch } = useApiQuery(
    () => api.feed.get({ limit: PAGE_SIZE }),
    [],
  );

  const allItems: FeedItem[] = feedItems ?? [];

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const renderItem = ({ item }: { item: FeedItem }) => (
    <FeedCard item={item} />
  );

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.skeletons}>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </View>
      );
    }
    if (error) {
      return (
        <EmptyState
          title="Couldn't load feed"
          body="Check your connection and try again."
          ctaLabel="Retry"
          onCta={refetch}
        />
      );
    }
    return (
      <EmptyState
        title="Your feed is empty"
        body="Log some content or follow people to see their activity here."
        ctaLabel="Log something"
        onCta={() => router.push('/compose/log')}
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
          NOETIC
        </Text>
        <Pressable
          onPress={() => router.push('/compose/log')}
          style={styles.compose}
          accessibilityLabel="Log content"
          accessibilityRole="button"
        >
          <PlusIcon size={20} color={Colors.primaryText} />
        </Pressable>
      </View>

      <FlatList
        data={allItems}
        keyExtractor={(item) => item.logEntry?.id ?? item.id ?? String(Math.random())}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={loading && allItems.length > 0}
            onRefresh={handleRefresh}
            tintColor={Colors.accentGold}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  compose: {
    padding: Spacing[2],
  },
  list: {
    paddingTop: Spacing[3],
    paddingBottom: Spacing[12],
  },
  skeletons: {
    paddingTop: Spacing[3],
  },
});
