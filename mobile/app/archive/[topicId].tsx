import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { FolderGrid } from '@/components/archive/FolderGrid';
import { FileList } from '@/components/archive/FileList';
import { SponsoredCard } from '@/components/ui/SponsoredCard';

/** Stable per-folder parity: true for ~half of folder ids, so an ad lands on
 *  roughly every other folder rather than every one. */
function folderShowsAd(topicId: string): boolean {
  let sum = 0;
  for (let i = 0; i < topicId.length; i++) sum += topicId.charCodeAt(i);
  return sum % 2 === 0;
}

export default function ArchiveFolderScreen() {
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const c = useThemeColors();
  const router = useRouter();

  const { data, loading, refetch } = useApiQuery(() => api.archive.get(topicId), [topicId], {
    cacheKey: `archive.get:${topicId}`,
  });

  // Pull-to-refresh only — background revalidation never shows the spinner.
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.nav, { borderBottomColor: c.border }]}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <ChevronLeftIcon size={22} color={c.text} />
          </Pressable>
        </View>
        <AsciiLoader fill variant="cat" size={80} message="pulling the folder…" />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <EmptyState title="Folder not found" ctaLabel="Back" onCta={() => router.back()} />
      </SafeAreaView>
    );
  }

  const isEmpty = data.subfolders.length === 0 && data.entries.length === 0;
  // Only about every other folder carries an ad — a stable hash of the folder
  // id decides, so the same folder is always consistent (no flicker on refresh)
  // and browsing subfolders doesn't hit an ad on every single screen.
  const adForThisFolder = !isEmpty && folderShowsAd(topicId);
  // The seam between the subfolder grid and the file list is the one place an
  // ad reads as a divider rather than an interruption. With no grid there is
  // no seam, so it goes under the list instead of on top of the folder.
  const adAtSeam = adForThisFolder && data.subfolders.length > 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.nav, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="monoSmall" color="muted" numberOfLines={1} style={styles.navTitle}>
          {data.name}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onPullRefresh()} tintColor={c.text} />}
        showsVerticalScrollIndicator={false}
      >
        {isEmpty && (
          <View style={styles.emptyWrap}>
            <Text variant="monoSmall" style={{ color: c.muted, textAlign: 'center', letterSpacing: 1.5 }}>
              nothing filed here yet.
            </Text>
          </View>
        )}

        {data.subfolders.length > 0 && (
          <View style={styles.gridWrap}>
            <FolderGrid folders={data.subfolders} />
          </View>
        )}

        {adAtSeam ? <SponsoredCard /> : null}

        <FileList entries={data.entries} />

        {adForThisFolder && !adAtSeam ? <SponsoredCard /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  back: {},
  navTitle: {
    flex: 1,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  content: { paddingBottom: Spacing[16] },
  gridWrap: { paddingHorizontal: Spacing[4] },
  emptyWrap: {
    paddingTop: Spacing[20],
    alignItems: 'center',
  },
});
