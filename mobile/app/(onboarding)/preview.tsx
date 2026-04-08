import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { TasteGraph } from '@/components/profile/TasteGraph';
import { Skeleton } from '@/components/ui/Skeleton';

export default function PreviewScreen() {
  const router = useRouter();
  const { refreshProfile, profile: authProfile } = useAuth();
  const [completing, setCompleting] = useState(false);

  const { data, loading } = useApiQuery(
    () => api.profile.me().then((r) => r.profile),
    [],
  );

  const profile = data ?? authProfile;

  const topTopics = profile?.tasteVector
    ? Object.entries(profile.tasteVector)
        .filter(([k]) => k.startsWith('topic:'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k]) => k.replace('topic:', ''))
    : [];

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    await refreshProfile();
    router.replace('/(tabs)');
  }, [refreshProfile, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.dots}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={[styles.dot, styles.dotFilled, i === 3 && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.header}>
          <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.accentGold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Step 4 of 4
          </Text>
          <Text variant="h2">Your profile is ready.</Text>
          <Text variant="body" color="secondary" style={styles.subtitle}>
            This is how others will see your intellectual identity.
          </Text>
        </View>

        <View style={styles.profileCard}>
          {loading ? (
            <View style={styles.skeletonHero}>
              <Skeleton width={80} height={80} radius={40} />
              <Skeleton width="60%" height={22} style={{ marginTop: 16 }} />
              <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
            </View>
          ) : (
            <>
              <View style={styles.hero}>
                <Avatar
                  uri={profile?.avatarUrl}
                  displayName={profile?.displayName}
                  size="xl"
                />
                <Text variant="h3" style={styles.displayName}>
                  {profile?.displayName ?? 'Your name'}
                </Text>
                <Text variant="mono" color="muted">
                  @{profile?.handle ?? 'handle'}
                </Text>
                {profile?.identitySummary && (
                  <Text variant="body" color="secondary" style={styles.summary}>
                    {profile.identitySummary}
                  </Text>
                )}
              </View>

              {topTopics.length > 0 && (
                <View style={styles.section}>
                  <Text variant="label" color="muted" style={styles.sectionLabel}>
                    Top topics
                  </Text>
                  <View style={styles.topicsRow}>
                    {topTopics.map((t) => (
                      <Badge key={t} label={t} variant="topic" />
                    ))}
                  </View>
                </View>
              )}

              {profile?.tasteVector && Object.keys(profile.tasteVector).length > 0 && (
                <View style={styles.section}>
                  <Text variant="label" color="muted" style={styles.sectionLabel}>
                    Taste graph
                  </Text>
                  <TasteGraph tasteVector={profile.tasteVector} size={240} />
                </View>
              )}

              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text variant="h3" color="accent">{profile?.followersCount ?? 0}</Text>
                  <Text variant="caption" color="muted">followers</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text variant="h3" color="accent">{profile?.followingCount ?? 0}</Text>
                  <Text variant="caption" color="muted">following</Text>
                </View>
              </View>
            </>
          )}
        </View>

        <View style={styles.footer}>
          <Button
            label="Enter NOETIC →"
            onPress={handleComplete}
            variant="primary"
            size="lg"
            fullWidth
            loading={completing}
            accessibilityLabel="Complete onboarding and enter NOETIC"
          />
          <Text variant="caption" color="muted" style={styles.footerNote}>
            You can always update your profile later in settings.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[8] },
  dots: { flexDirection: 'row', gap: 8, paddingTop: Spacing[6], paddingBottom: Spacing[4] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.cardBorder },
  dotFilled: { backgroundColor: Colors.accentGold },
  dotActive: { width: 24 },
  header: { marginBottom: Spacing[6] },
  subtitle: { marginTop: Spacing[2] },
  profileCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius['3xl'],
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: Spacing[6],
    marginBottom: Spacing[6],
  },
  skeletonHero: { alignItems: 'center', paddingVertical: Spacing[6] },
  hero: { alignItems: 'center', marginBottom: Spacing[6] },
  displayName: { marginTop: Spacing[4] },
  summary: { textAlign: 'center', marginTop: Spacing[2], maxWidth: 260 },
  section: { marginBottom: Spacing[5] },
  sectionLabel: { marginBottom: Spacing[3] },
  topicsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing[8],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  stat: { alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.cardBorder },
  footer: { gap: Spacing[3] },
  footerNote: { textAlign: 'center' },
});
