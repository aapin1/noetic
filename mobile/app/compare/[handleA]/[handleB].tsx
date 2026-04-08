import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { CompareResult } from '@/types/api';
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function SectionBlock({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color?: string;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.block}>
      <Text variant="label" color="muted" style={styles.blockLabel}>{title}</Text>
      <View style={styles.chipRow}>
        {items.map((item) => (
          <Badge key={item} label={item} variant="topic" />
        ))}
      </View>
    </View>
  );
}

export default function CompareScreen() {
  const { handleA, handleB } = useLocalSearchParams<{ handleA: string; handleB: string }>();
  const router = useRouter();

  const { data, loading, error } = useApiQuery(
    () => api.compare.profiles(handleB),
    [handleB],
  );

  const pct = data ? Math.round(data.overlapScore * 100) : 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <ChevronLeftIcon size={22} color={Colors.primaryText} />
          </Pressable>
        </View>
        <SkeletonCard />
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <ChevronLeftIcon size={22} color={Colors.primaryText} />
          </Pressable>
        </View>
        <EmptyState title="Couldn't compare profiles" body="Try again later." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={Colors.primaryText} />
        </Pressable>
        <Text variant="mono" color="muted">Compare</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profilesRow}>
          <View style={styles.profileCol}>
            <Avatar
              uri={data.viewerProfile.avatarUrl}
              displayName={data.viewerProfile.displayName}
              size="lg"
            />
            <Text variant="bodyMedium" style={styles.profileName} numberOfLines={1}>
              {data.viewerProfile.displayName}
            </Text>
            <Text variant="monoSmall" color="muted">@{data.viewerProfile.handle}</Text>
          </View>

          <View style={styles.scoreContainer}>
            <View style={styles.scoreCircle}>
              <Text
                style={{
                  fontFamily: FontFamily.heading,
                  fontSize: 32,
                  color: Colors.accentGold,
                  textAlign: 'center',
                }}
              >
                {pct}%
              </Text>
            </View>
            <Text variant="monoSmall" color="muted" style={styles.scoreLabel}>overlap</Text>
          </View>

          <View style={styles.profileCol}>
            <Avatar
              uri={data.targetProfile.avatarUrl}
              displayName={data.targetProfile.displayName}
              size="lg"
            />
            <Text variant="bodyMedium" style={styles.profileName} numberOfLines={1}>
              {data.targetProfile.displayName}
            </Text>
            <Text variant="monoSmall" color="muted">@{data.targetProfile.handle}</Text>
          </View>
        </View>

        {data.editorialSummary && (
          <View style={styles.summaryCard}>
            <Text variant="body" color="secondary" style={{ fontStyle: 'italic', lineHeight: 24 }}>
              "{data.editorialSummary}"
            </Text>
          </View>
        )}

        <SectionBlock title="Shared topics" items={data.sharedTopics} />
        <SectionBlock title="Shared sources" items={data.sharedSources} />
        <SectionBlock title={`Unique to @${handleA}`} items={data.viewerUniqueTopics} />
        <SectionBlock title={`Unique to @${handleB}`} items={data.targetUniqueTopics} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  backBtn: { padding: Spacing[2] },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing[12] },
  profilesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[8],
    gap: Spacing[2],
  },
  profileCol: { alignItems: 'center', flex: 1, gap: Spacing[2] },
  profileName: { textAlign: 'center' },
  scoreContainer: { alignItems: 'center', gap: Spacing[2], flex: 1 },
  scoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: Colors.accentGold,
    backgroundColor: Colors.accentGoldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreLabel: {},
  summaryCard: {
    marginHorizontal: Spacing[6],
    padding: Spacing[5],
    backgroundColor: Colors.surface,
    borderRadius: Radius['2xl'],
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: Spacing[6],
  },
  block: {
    paddingHorizontal: Spacing[6],
    marginBottom: Spacing[5],
  },
  blockLabel: { marginBottom: Spacing[3] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
});
