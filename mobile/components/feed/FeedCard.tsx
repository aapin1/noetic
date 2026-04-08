import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BookmarkIcon, HeartIcon, UserPlusIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import type { FeedItem } from '@/types/api';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';

interface Props {
  item: FeedItem;
}

function RatingDots({ rating }: { rating: number }) {
  const filled = Math.round((rating / 10) * 5);
  return (
    <View style={styles.ratingRow}>
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.ratingDot,
            { backgroundColor: i < filled ? Colors.accentGold : Colors.elevatedSurface },
          ]}
        />
      ))}
      <Text variant="monoSmall" color="muted" style={styles.ratingLabel}>
        {rating}/10
      </Text>
    </View>
  );
}

export function FeedCard({ item }: Props) {
  const router = useRouter();
  const log = item.logEntry;
  const user = item.user ?? log?.user;
  const content = log?.contentItem;

  const [liked, setLiked] = useState(log?.isLiked ?? false);
  const [saved, setSaved] = useState(log?.isSaved ?? false);
  const [likeCount, setLikeCount] = useState(log?.likeCount ?? 0);

  if (!log || !content) return null;

  const handleLike = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    try {
      await api.social.likeReview(log.id);
    } catch {
      setLiked(!next);
      setLikeCount((c) => c + (next ? -1 : 1));
    }
  };

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !saved;
    setSaved(next);
    try {
      await api.social.saveContent(content.id);
    } catch {
      setSaved(!next);
    }
  };

  return (
    <Pressable onPress={() => router.push(`/content/${content.id}`)}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.push(`/profile/${user?.handle}`)}
            style={styles.userRow}
          >
            <Avatar
              uri={user?.avatarUrl}
              displayName={user?.displayName}
              size="sm"
            />
            <View style={styles.userInfo}>
              <Text variant="bodyMedium">{user?.displayName}</Text>
              <Text variant="caption" color="muted">
                @{user?.handle}
              </Text>
            </View>
          </Pressable>
          {item.reason && (
            <View style={styles.reasonChip}>
              <Text variant="monoSmall" color="muted">{item.reason}</Text>
            </View>
          )}
        </View>

        <View style={styles.contentMeta}>
          {content.contentType && (
            <Badge
              label={content.contentType}
              variant="contentType"
              small
            />
          )}
          {content.sourceName && (
            <Text variant="monoSmall" color="muted" style={styles.source}>
              {content.sourceName}
            </Text>
          )}
        </View>

        <Text variant="h4" style={styles.title} numberOfLines={2}>
          {content.title}
        </Text>

        {log.rating !== null && log.rating !== undefined && (
          <RatingDots rating={log.rating} />
        )}

        {log.review ? (
          <Text variant="body" color="secondary" style={styles.review} numberOfLines={3}>
            "{log.review}"
          </Text>
        ) : log.annotation ? (
          <Text variant="body" color="secondary" style={styles.review} numberOfLines={3}>
            {log.annotation}
          </Text>
        ) : null}

        {log.topics.length > 0 && (
          <View style={styles.topics}>
            {log.topics.slice(0, 3).map((t) => (
              <Pressable key={t} onPress={() => router.push(`/topics/${t}`)}>
                <Badge label={t} variant="topic" small />
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          <Text variant="monoSmall" color="muted">
            {new Date(log.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={handleLike} style={styles.actionBtn} accessibilityLabel={liked ? 'Unlike' : 'Like'}>
              <HeartIcon
                size={16}
                color={liked ? Colors.danger : Colors.mutedText}
                fill={liked ? Colors.danger : 'transparent'}
              />
              {likeCount > 0 && (
                <Text variant="monoSmall" color={liked ? 'danger' : 'muted'} style={styles.actionCount}>
                  {likeCount}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={handleSave} style={styles.actionBtn} accessibilityLabel={saved ? 'Unsave' : 'Save'}>
              <BookmarkIcon
                size={16}
                color={saved ? Colors.accentGold : Colors.mutedText}
                fill={saved ? Colors.accentGold : 'transparent'}
              />
            </Pressable>
            <Pressable
              onPress={() => router.push(`/profile/${user?.handle}`)}
              style={styles.actionBtn}
              accessibilityLabel="View profile"
            >
              <UserPlusIcon size={16} color={Colors.mutedText} />
            </Pressable>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing[4],
    marginBottom: Spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing[3],
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flex: 1,
  },
  userInfo: {
    flex: 1,
  },
  reasonChip: {
    backgroundColor: Colors.elevatedSurface,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    maxWidth: 100,
  },
  contentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginBottom: Spacing[2],
  },
  source: {
    flex: 1,
  },
  title: {
    marginBottom: Spacing[2],
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: Spacing[2],
  },
  ratingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ratingLabel: {
    marginLeft: 4,
  },
  review: {
    marginBottom: Spacing[3],
    fontStyle: 'italic',
    lineHeight: 22,
  },
  topics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1],
    marginBottom: Spacing[3],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing[3],
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing[4],
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionCount: {
    lineHeight: 16,
  },
});
