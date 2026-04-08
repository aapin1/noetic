import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/api';
import { Colors, Spacing } from '@/constants/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';

interface Props {
  user: UserProfile & { similarityScore?: number };
  compact?: boolean;
}

export function UserCard({ user, compact = false }: Props) {
  const router = useRouter();
  const { profile: me } = useAuth();
  const [following, setFollowing] = useState(user.isFollowing ?? false);
  const [loading, setLoading] = useState(false);
  const isMe = me?.id === user.id;

  const handleFollow = async () => {
    setLoading(true);
    const next = !following;
    setFollowing(next);
    try {
      if (next) await api.social.follow(user.id);
      else await api.social.unfollow(user.id);
    } catch {
      setFollowing(!next);
    } finally {
      setLoading(false);
    }
  };

  const topTopics = user.tasteVector
    ? Object.entries(user.tasteVector)
        .filter(([k]) => k.startsWith('topic:'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k.replace('topic:', ''))
    : [];

  return (
    <Pressable onPress={() => router.push(`/profile/${user.handle}`)}>
      <Card style={[styles.card, compact && styles.compact]}>
        <View style={styles.row}>
          <Avatar uri={user.avatarUrl} displayName={user.displayName} size={compact ? 'sm' : 'md'} />
          <View style={styles.info}>
            <Text variant="bodySemiBold">{user.displayName}</Text>
            <Text variant="caption" color="muted">@{user.handle}</Text>
            {user.similarityScore !== undefined && (
              <View style={styles.scoreRow}>
                <Text variant="monoSmall" color="accent">
                  {user.similarityScore.toFixed(0)}% overlap
                </Text>
              </View>
            )}
          </View>
          {!isMe && (
            <Button
              label={following ? 'Following' : 'Follow'}
              variant={following ? 'secondary' : 'primary'}
              size="sm"
              onPress={handleFollow}
              loading={loading}
              style={styles.followBtn}
            />
          )}
        </View>
        {!compact && topTopics.length > 0 && (
          <View style={styles.topics}>
            {topTopics.map((t) => (
              <Badge key={t} label={t} variant="topic" small />
            ))}
          </View>
        )}
        {!compact && user.identitySummary && (
          <Text variant="caption" color="secondary" style={styles.summary} numberOfLines={2}>
            {user.identitySummary}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Spacing[2],
  },
  compact: {
    padding: Spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  info: {
    flex: 1,
  },
  scoreRow: {
    marginTop: 2,
  },
  followBtn: {
    minWidth: 80,
  },
  topics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[1],
    marginTop: Spacing[3],
  },
  summary: {
    marginTop: Spacing[2],
  },
});
