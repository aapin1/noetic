import React, { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon, ExternalLinkIcon, PlusIcon } from 'lucide-react-native';
import { Image } from 'expo-image';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import type { ContentPage, LogEntry } from '@/types/api';
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

function ReviewCard({ entry }: { entry: LogEntry }) {
  const router = useRouter();
  const filled = entry.rating ? Math.round((entry.rating / 10) * 5) : 0;
  return (
    <Card style={styles.reviewCard}>
      <Pressable
        onPress={() => router.push(`/profile/${entry.user.handle}`)}
        style={styles.reviewerRow}
      >
        <Avatar uri={entry.user.avatarUrl} displayName={entry.user.displayName} size="sm" />
        <View>
          <Text variant="bodySemiBold">{entry.user.displayName}</Text>
          <Text variant="monoSmall" color="muted">@{entry.user.handle}</Text>
        </View>
      </Pressable>
      {entry.rating !== null && entry.rating !== undefined && (
        <View style={styles.ratingRow}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View
              key={i}
              style={[styles.ratingDot, { backgroundColor: i < filled ? Colors.accentGold : Colors.elevatedSurface }]}
            />
          ))}
          <Text variant="monoSmall" color="muted"> {entry.rating}/10</Text>
        </View>
      )}
      {entry.review && (
        <Text variant="body" color="secondary" style={styles.reviewText}>
          "{entry.review}"
        </Text>
      )}
      {entry.annotation && !entry.review && (
        <Text variant="body" color="secondary" style={styles.reviewText}>
          {entry.annotation}
        </Text>
      )}
      {entry.topics.length > 0 && (
        <View style={styles.topicsRow}>
          {entry.topics.slice(0, 3).map((t) => (
            <Badge key={t} label={t} variant="topic" small />
          ))}
        </View>
      )}
      <Text variant="monoSmall" color="muted" style={styles.reviewDate}>
        {new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </Text>
    </Card>
  );
}

export default function ContentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: page, loading, error } = useApiQuery(
    () => api.content.getById(id),
    [id],
  );

  const item = page?.contentItem;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeftIcon size={22} color={Colors.primaryText} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error || !item) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeftIcon size={22} color={Colors.primaryText} />
          </Pressable>
        </View>
        <EmptyState title="Content not found" body="This content may have been removed." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={Colors.primaryText} />
        </Pressable>
        <Pressable
          onPress={() => router.push(`/compose/log?contentId=${id}` as never)}
          style={styles.logBtn}
          accessibilityLabel="Log this content"
          accessibilityRole="button"
        >
          <PlusIcon size={20} color={Colors.primaryText} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {item.imageUrl && (
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.coverImage}
            contentFit="cover"
            accessibilityLabel={item.title}
          />
        )}

        <View style={styles.hero}>
          <View style={styles.metaRow}>
            {item.contentType && (
              <Badge label={item.contentType} variant="contentType" />
            )}
            {item.sourceName && (
              <Text variant="monoSmall" color="muted">{item.sourceName}</Text>
            )}
          </View>

          <Text variant="h2" style={styles.title}>{item.title}</Text>

          {item.authorName && (
            <Text variant="body" color="secondary" style={styles.author}>
              by {item.authorName}
            </Text>
          )}

          {item.description && (
            <Text variant="body" color="secondary" style={styles.description}>
              {item.description}
            </Text>
          )}

          {item.canonicalUrl && (
            <Pressable
              onPress={() => Linking.openURL(item.canonicalUrl!)}
              style={styles.sourceLink}
              accessibilityRole="link"
              accessibilityLabel="Open original source"
            >
              <ExternalLinkIcon size={14} color={Colors.accentGold} />
              <Text variant="monoSmall" color="accent"> Read original</Text>
            </Pressable>
          )}

          {item.topics.length > 0 && (
            <View style={styles.topicsRow}>
              {item.topics.map((t) => (
                <Pressable key={t} onPress={() => router.push(`/topics/${t}`)}>
                  <Badge label={t} variant="topic" />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {page?.reviews && page.reviews.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionLabel}>
              Reviews ({page.reviews.length})
            </Text>
            {page.reviews.map((r) => (
              <ReviewCard key={r.id} entry={r} />
            ))}
          </View>
        )}

        {page?.similarContent && page.similarContent.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionLabel}>Similar content</Text>
            {page.similarContent.slice(0, 5).map((s) => (
              <Pressable
                key={s.id}
                onPress={() => router.push(`/content/${s.id}`)}
                style={styles.similarRow}
              >
                <View style={styles.similarInfo}>
                  {s.contentType && <Badge label={s.contentType} variant="contentType" small />}
                  <Text variant="bodyMedium" numberOfLines={2} style={{ marginTop: 4 }}>{s.title}</Text>
                  {s.sourceName && <Text variant="caption" color="muted">{s.sourceName}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        )}
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
  logBtn: { padding: Spacing[2] },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing[12] },
  coverImage: {
    width: '100%',
    height: 200,
    backgroundColor: Colors.elevatedSurface,
  },
  hero: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[6],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginBottom: Spacing[3],
  },
  title: { marginBottom: Spacing[2] },
  author: { marginBottom: Spacing[3] },
  description: { marginBottom: Spacing[4], lineHeight: 24 },
  sourceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing[4],
  },
  topicsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginTop: Spacing[2],
  },
  section: {
    paddingHorizontal: Spacing[6],
    marginBottom: Spacing[6],
  },
  sectionLabel: { marginBottom: Spacing[3] },
  reviewCard: { marginBottom: Spacing[3] },
  reviewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    marginBottom: Spacing[3],
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: Spacing[2],
  },
  ratingDot: { width: 6, height: 6, borderRadius: 3 },
  reviewText: {
    fontStyle: 'italic',
    lineHeight: 22,
    marginBottom: Spacing[2],
  },
  reviewDate: { marginTop: Spacing[1] },
  similarRow: {
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  similarInfo: {},
});
