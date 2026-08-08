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
import { Accents, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { EditableAvatar } from '@/components/profile/EditableAvatar';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { WrappedSection, wrappedAccent } from '@/components/wrapped/WrappedSection';
import { ShareAtlasEntry, ShareRecapEntry } from '@/components/share/ShareRecapEntry';
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
        {/* Card stock, like every other panel on the page. It reads as the
            first card in the stack rather than as a slab dropped on top of
            it — the accent dot is the same mark the wrapped cards carry. */}
        <View style={[styles.hero, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.heroDot, { backgroundColor: Accents.slate }]} />
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
        {/* Same accent the wrapped kicker is wearing, so the two shelves on
            this page read as one run rather than as two unrelated colours. */}
        <ShareRecapEntry accent={wrappedAccent(wrapped)} />
        {/* Hidden on an empty map — an atlas with no points has nothing to share. */}
        {(wrapped?.totalCaptures ?? 0) > 0 && <ShareAtlasEntry accent={wrappedAccent(wrapped)} />}

        <View style={styles.editButtonWrap}>
          {/* Untinted. An ochre wash on the one button at the foot of the page
              read as a warning, not as "edit" — it takes the neutral card
              stock every other control on this screen uses. */}
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
    paddingVertical: Spacing[2],
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
  heroDot: {
    position: 'absolute',
    top: Spacing[4],
    right: Spacing[4],
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bio: { marginTop: Spacing[3], textAlign: 'center', maxWidth: 320 },
  editButtonWrap: { paddingHorizontal: Spacing[6], marginTop: Spacing[6] },
});
