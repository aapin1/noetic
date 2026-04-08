import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon, GitMergeIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/api';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TasteGraph } from '@/components/profile/TasteGraph';
import { SkeletonProfile } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

export default function PublicProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const { profile: me } = useAuth();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followLoading, setFollowLoading] = useState(false);

  const { data: profile, loading, error } = useApiQuery(
    () => api.profile.getByHandle(handle).then((r) => r.profile),
    [handle],
  );

  const isMe = me?.id === profile?.id;
  const isFollowing = following !== null ? following : profile?.isFollowing ?? false;

  const topTopics = profile?.tasteVector
    ? Object.entries(profile.tasteVector)
        .filter(([k]) => k.startsWith('topic:'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k.replace('topic:', ''))
    : [];

  const handleFollow = async () => {
    if (!profile) return;
    setFollowLoading(true);
    const next = !isFollowing;
    setFollowing(next);
    try {
      if (next) await api.social.follow(profile.id);
      else await api.social.unfollow(profile.id);
    } catch {
      setFollowing(!next);
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <ChevronLeftIcon size={22} color={Colors.primaryText} />
          </Pressable>
        </View>
        <SkeletonProfile />
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <ChevronLeftIcon size={22} color={Colors.primaryText} />
          </Pressable>
        </View>
        <EmptyState title="Profile not found" body="This profile may have been removed or doesn't exist." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={Colors.primaryText} />
        </Pressable>
        <Text variant="mono" color="muted">@{profile.handle}</Text>
        {!isMe && (
          <Pressable
            onPress={() => router.push(`/compare/${me?.handle}/${profile.handle}` as never)}
            style={styles.compareBtn}
            accessibilityLabel="Compare profiles"
            accessibilityRole="button"
          >
            <GitMergeIcon size={20} color={Colors.accentGold} />
          </Pressable>
        )}
        {isMe && <View style={{ width: 44 }} />}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Avatar uri={profile.avatarUrl} displayName={profile.displayName} size="xl" />
          <Text variant="h3" style={styles.displayName}>{profile.displayName}</Text>
          <Text variant="mono" color="muted">@{profile.handle}</Text>
          {profile.identitySummary && (
            <Text variant="body" color="secondary" style={styles.summary}>
              {profile.identitySummary}
            </Text>
          )}
          {!isMe && (
            <Button
              label={isFollowing ? 'Following' : 'Follow'}
              variant={isFollowing ? 'secondary' : 'primary'}
              size="md"
              onPress={handleFollow}
              loading={followLoading}
              style={styles.followBtn}
              accessibilityLabel={isFollowing ? 'Unfollow' : 'Follow this person'}
            />
          )}
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text variant="h3" color="accent">{profile.followersCount}</Text>
            <Text variant="caption" color="muted">followers</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text variant="h3" color="accent">{profile.followingCount}</Text>
            <Text variant="caption" color="muted">following</Text>
          </View>
        </View>

        {topTopics.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionLabel}>Top topics</Text>
            <View style={styles.topicsRow}>
              {topTopics.map((t) => (
                <Pressable key={t} onPress={() => router.push(`/topics/${t}`)}>
                  <Badge label={t} variant="topic" />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {profile.tasteVector && Object.keys(profile.tasteVector).length > 2 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionLabel}>Taste graph</Text>
            <TasteGraph tasteVector={profile.tasteVector} size={260} />
          </View>
        )}

        {profile.bio && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionLabel}>About</Text>
            <Text variant="body" color="secondary">{profile.bio}</Text>
          </View>
        )}

        {profile.publicNotes && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionLabel}>Public notes</Text>
            <Text variant="body" color="secondary">{profile.publicNotes}</Text>
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
  backBtn: { padding: Spacing[2], width: 44 },
  compareBtn: { padding: Spacing[2], width: 44, alignItems: 'flex-end' },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing[12] },
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing[8],
    paddingHorizontal: Spacing[6],
  },
  displayName: { marginTop: Spacing[4] },
  summary: { textAlign: 'center', marginTop: Spacing[2], maxWidth: 280 },
  followBtn: { marginTop: Spacing[5], minWidth: 120 },
  stats: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing[5],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.cardBorder,
    marginHorizontal: Spacing[6],
    gap: Spacing[8],
  },
  stat: { alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.cardBorder },
  section: { paddingHorizontal: Spacing[6], marginTop: Spacing[6] },
  sectionLabel: { marginBottom: Spacing[3] },
  topicsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
});
