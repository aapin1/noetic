import React, { useCallback, useRef, useState } from 'react';
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
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { EditableAvatar } from '@/components/profile/EditableAvatar';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { WrappedSection } from '@/components/wrapped/WrappedSection';
import { ShareRecapEntry } from '@/components/share/ShareRecapEntry';
import type { OwnerProfile } from '@/types/api';

export default function YouScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile: authProfile, refreshProfile } = useAuth();
  const scrollY = useSharedValue(0);
  const scroller = useRef<Animated.ScrollView>(null);

  const { data: profile, refetch } = useApiQuery(
    () => api.profile.me().then((r) => r.profile),
    [],
    { cacheKey: 'profile.me:profile' },
  );
  const { data: wrapped, loading: wrappedLoading, refetch: refetchWrapped } = useApiQuery(
    () => api.profile.wrapped(),
    [],
    { cacheKey: 'profile.wrapped' },
  );

  // Pull-to-refresh only. Focus revalidation happens silently in the
  // background — tying the spinner to `loading` made every visit to this tab
  // open with a loading state even though cached data was already on screen.
  const [refreshing, setRefreshing] = useState(false);

  // Optimistic override so a freshly-changed avatar shows immediately.
  const [override, setOverride] = useState<OwnerProfile | null>(null);
  const p = override ?? profile ?? authProfile;

  // Captures can be deleted from anywhere in the app, so the stats are only
  // trustworthy if they're re-read every time this tab comes back into view.
  useFocusEffect(
    useCallback(() => {
      // Always land at the hero, even if the tab was left scrolled down.
      scroller.current?.scrollTo({ y: 0, animated: false });
      void refetch();
      void refetchWrapped();
    }, [refetch, refetchWrapped]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchWrapped()]);
      await refreshProfile();
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchWrapped, refreshProfile]);

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
    <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
      {/* A dark chrome band, the way the Atlas wears its wordmark on the map.
          The safe-area strip above takes the same colour, so the notch region
          reads as part of the header rather than as a pale sliver over it. */}
      <View style={[styles.header, { borderBottomColor: c.deepBorder, backgroundColor: c.deep }]}>
        <Text variant="wordmark" style={{ color: c.deepInk }}>you</Text>
        <Pressable onPress={() => router.push('/settings')} accessibilityLabel="Settings">
          <SettingsIcon size={22} color={c.deepInkMuted} />
        </Pressable>
      </View>
      <Animated.ScrollView
        ref={scroller}
        style={{ backgroundColor: c.canvas }}
        contentContainerStyle={styles.content}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={c.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* The page's anchor, cut from the same near-black the Atlas is drawn
            on. This tab was paper all the way down while the map half of the
            app is a dark field — one deep panel at the top is what ties the two
            together, and it works in light mode, which is where the gap was. */}
        <View style={[styles.hero, { backgroundColor: c.deep, borderColor: c.deepBorder }]}>
          <EditableAvatar profile={p} onChanged={handleAvatarChanged} />
          <Text variant="h3" style={{ marginTop: Spacing[4], color: c.deepInk }}>
            {p?.displayName ?? '—'}
          </Text>
          <Text variant="mono" style={{ color: c.deepInkMuted }}>
            @{p?.handle ?? '—'}
          </Text>
          {p?.bio ? (
            <Text variant="serif" style={[styles.bio, { color: c.deepInkMuted }]}>
              {p.bio}
            </Text>
          ) : null}
        </View>

        {!wrapped && wrappedLoading ? (
          <AsciiLoader
            variant="cat"
            size={72}
            message={['counting your captures…', 'dusting the shelves…', 'adding it all up…']}
          />
        ) : (
          <WrappedSection scrollY={scrollY} stats={wrapped} settled={!wrappedLoading} />
        )}

        {/* Ads are interleaved between the wrapped cards inside WrappedSection now,
            rather than a single card stranded at the bottom of the page. */}
        <ShareRecapEntry />

        <View style={styles.editButtonWrap}>
          <Button
            label="Edit profile"
            variant="secondary"
            size="md"
            fullWidth
            onPress={() => router.push('/profile/edit' as never)}
          />
        </View>
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
  hero: {
    alignItems: 'center',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[8],
    marginHorizontal: Spacing[4],
    marginTop: Spacing[4],
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bio: { marginTop: Spacing[3], textAlign: 'center', maxWidth: 320 },
  editButtonWrap: { paddingHorizontal: Spacing[6], marginTop: Spacing[6] },
});
