import React, { useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SettingsIcon, EditIcon, ExternalLinkIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import type { OwnerProfile } from '@/types/api';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TasteGraph } from '@/components/profile/TasteGraph';
import { SkeletonProfile } from '@/components/ui/Skeleton';

export default function OwnProfileScreen() {
  const router = useRouter();
  const { profile: authProfile, refreshProfile } = useAuth();

  const { data, loading, refetch } = useApiQuery(
    () => api.profile.me().then((r) => r.profile),
    [],
  );

  const profile = data ?? authProfile;

  const topTopics = profile?.tasteVector
    ? Object.entries(profile.tasteVector)
        .filter(([k]) => k.startsWith('topic:'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k.replace('topic:', ''))
    : [];

  const handleRefresh = useCallback(async () => {
    await refetch();
    await refreshProfile();
  }, [refetch, refreshProfile]);

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={{ fontFamily: FontFamily.heading, fontSize: 18, color: Colors.primaryText, letterSpacing: 4 }}>
            Profile
          </Text>
        </View>
        <SkeletonProfile />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={{ fontFamily: FontFamily.heading, fontSize: 18, color: Colors.primaryText, letterSpacing: 4 }}>
          Profile
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/profile/edit' as never)}
            style={styles.iconBtn}
            accessibilityLabel="Edit profile"
            accessibilityRole="button"
          >
            <EditIcon size={20} color={Colors.primaryText} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            style={styles.iconBtn}
            accessibilityLabel="Settings"
            accessibilityRole="button"
          >
            <SettingsIcon size={20} color={Colors.primaryText} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={Colors.accentGold}
          />
        }
      >
        <View style={styles.hero}>
          <Avatar
            uri={profile?.avatarUrl}
            displayName={profile?.displayName}
            size="xl"
          />
          <Text variant="h3" style={styles.displayName}>{profile?.displayName}</Text>
          <Text variant="mono" color="muted">@{profile?.handle}</Text>
          {profile?.identitySummary && (
            <Text variant="body" color="secondary" style={styles.summary}>
              {profile.identitySummary}
            </Text>
          )}
          {profile?.bio && !profile.identitySummary && (
            <Text variant="body" color="secondary" style={styles.summary}>
              {profile.bio}
            </Text>
          )}
        </View>

        <View style={styles.stats}>
          <Pressable
            style={styles.stat}
            onPress={() => router.push(`/profile/${profile?.handle}/followers` as never)}
            accessibilityRole="button"
            accessibilityLabel={`${profile?.followersCount} followers`}
          >
            <Text variant="h3" color="accent">{profile?.followersCount ?? 0}</Text>
            <Text variant="caption" color="muted">followers</Text>
          </Pressable>
          <View style={styles.statDivider} />
          <Pressable
            style={styles.stat}
            onPress={() => router.push(`/profile/${profile?.handle}/following` as never)}
            accessibilityRole="button"
            accessibilityLabel={`${profile?.followingCount} following`}
          >
            <Text variant="h3" color="accent">{profile?.followingCount ?? 0}</Text>
            <Text variant="caption" color="muted">following</Text>
          </Pressable>
          {profile && 'logCount' in profile && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text variant="h3" color="accent">{(profile as OwnerProfile).logCount ?? 0}</Text>
                <Text variant="caption" color="muted">logged</Text>
              </View>
            </>
          )}
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

        {profile?.tasteVector && Object.keys(profile.tasteVector).length > 2 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionLabel}>Taste graph</Text>
            <TasteGraph tasteVector={profile.tasteVector} size={260} />
          </View>
        )}

        <View style={styles.section}>
          <Button
            label="View public profile"
            onPress={() => router.push(`/profile/${profile?.handle}`)}
            variant="secondary"
            size="md"
            rightIcon={<ExternalLinkIcon size={14} color={Colors.secondaryText} />}
          />
        </View>
      </ScrollView>
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
  headerActions: { flexDirection: 'row', gap: Spacing[2] },
  iconBtn: { padding: Spacing[2] },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing[12] },
  hero: {
    alignItems: 'center',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[8],
  },
  displayName: { marginTop: Spacing[4] },
  summary: { textAlign: 'center', marginTop: Spacing[2], maxWidth: 280 },
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
  section: {
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[6],
  },
  sectionLabel: { marginBottom: Spacing[3] },
  topicsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
});
