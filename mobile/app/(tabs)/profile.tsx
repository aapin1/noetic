import React, { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SettingsIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';

export default function YouScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile: authProfile, refreshProfile } = useAuth();

  const { data: profile, loading, refetch } = useApiQuery(
    () => api.profile.me().then((r) => r.profile),
    [],
  );

  const { data: capList } = useApiQuery(() => api.captures.list({ limit: 80 }), []);
  const count = capList?.length ?? 0;

  const p = profile ?? authProfile;

  const handleRefresh = useCallback(async () => {
    await refetch();
    await refreshProfile();
  }, [refetch, refreshProfile]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">you</Text>
        <Pressable onPress={() => router.push('/settings')} accessibilityLabel="Settings">
          <SettingsIcon size={22} color={c.text} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void handleRefresh()} tintColor={c.text} />
        }
      >
        <View style={styles.hero}>
          <Avatar uri={p?.avatarUrl} displayName={p?.displayName} size="xl" />
          <Text variant="h3" style={{ marginTop: Spacing[4] }}>
            {p?.displayName ?? '—'}
          </Text>
          <Text variant="mono" color="muted">
            @{p?.handle ?? '—'}
          </Text>
          {p?.identitySummary ? (
            <Text variant="serif" color="secondary" style={{ marginTop: Spacing[3], textAlign: 'center' }}>
              {p.identitySummary}
            </Text>
          ) : null}
        </View>

        <View style={[styles.statCard, { borderColor: c.border }]}>
          <Text variant="label" color="muted">
            captures
          </Text>
          <Text variant="h2" style={{ marginTop: Spacing[2] }}>
            {count === 0 ? '—' : count}
          </Text>
        </View>

        <Button
          label="Edit profile"
          variant="secondary"
          size="md"
          fullWidth
          onPress={() => router.push('/profile/edit' as never)}
          style={{ marginTop: Spacing[6] }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  content: { paddingBottom: Spacing[16] },
  hero: { alignItems: 'center', paddingHorizontal: Spacing[6], paddingVertical: Spacing[8] },
  statCard: {
    marginHorizontal: Spacing[6],
    padding: Spacing[5],
    borderWidth: 1,
    borderRadius: 12,
  },
});
