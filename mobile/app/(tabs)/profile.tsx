import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SettingsIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { EditableAvatar } from '@/components/profile/EditableAvatar';
import { WrappedSection } from '@/components/wrapped/WrappedSection';
import type { OwnerProfile } from '@/types/api';

export default function YouScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile: authProfile, refreshProfile } = useAuth();
  const scrollY = useSharedValue(0);

  const { data: profile, loading, refetch } = useApiQuery(
    () => api.profile.me().then((r) => r.profile),
    [],
  );

  const { data: capList, refetch: refetchCaps } = useApiQuery(() => api.captures.list({ limit: 80 }), []);
  const count = capList?.length ?? 0;

  // Optimistic override so a freshly-changed avatar shows immediately.
  const [override, setOverride] = useState<OwnerProfile | null>(null);
  const p = override ?? profile ?? authProfile;

  useFocusEffect(
    useCallback(() => {
      void refetch();
      void refetchCaps();
    }, [refetch, refetchCaps]),
  );

  const handleRefresh = useCallback(async () => {
    await refetch();
    await refreshProfile();
  }, [refetch, refreshProfile]);

  const handleAvatarChanged = useCallback(
    (updated: OwnerProfile) => {
      setOverride(updated);
      void refetch();
      void refreshProfile();
    },
    [refetch, refreshProfile],
  );

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">you</Text>
        <Pressable onPress={() => router.push('/settings')} accessibilityLabel="Settings">
          <SettingsIcon size={22} color={c.text} />
        </Pressable>
      </View>
      <Animated.ScrollView
        contentContainerStyle={styles.content}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void handleRefresh()} tintColor={c.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <EditableAvatar profile={p} onChanged={handleAvatarChanged} />
          <Text variant="h3" style={{ marginTop: Spacing[4] }}>
            {p?.displayName ?? '—'}
          </Text>
          <Text variant="mono" color="muted">
            @{p?.handle ?? '—'}
          </Text>
          {p?.bio ? (
            <Text variant="serif" color="secondary" style={styles.bio}>
              {p.bio}
            </Text>
          ) : null}
        </View>

        <WrappedSection scrollY={scrollY} />

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
          style={styles.editButton}
        />
      </Animated.ScrollView>
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
  bio: { marginTop: Spacing[3], textAlign: 'center', maxWidth: 320 },
  statCard: {
    marginHorizontal: Spacing[6],
    marginTop: Spacing[6],
    padding: Spacing[5],
    borderWidth: 1,
    borderRadius: 12,
  },
  editButton: { marginHorizontal: Spacing[6], marginTop: Spacing[6] },
});
