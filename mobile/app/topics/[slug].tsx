import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { UserCard } from '@/components/profile/UserCard';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

export default function TopicScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();

  const { data: page, loading, error } = useApiQuery(
    () => api.topics.get(slug, 10),
    [slug],
  );

  const displayName = page?.name ?? slug.replace(/-/g, ' ');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={Colors.primaryText} />
        </Pressable>
        <Text variant="mono" color="muted" style={styles.navTitle}>{displayName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Badge label={displayName} variant="topic" />
          <Text variant="h2" style={styles.title}>{displayName}</Text>
        </View>

        {loading && (
          <>
            {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
          </>
        )}

        {error && (
          <EmptyState title="Couldn't load topic" body="Try again later." />
        )}

        {!loading && !error && page && (
          <>
            {page.topContent.length > 0 && (
              <View style={styles.section}>
                <Text variant="label" color="muted" style={styles.sectionLabel}>
                  Top content
                </Text>
                {page.topContent.slice(0, 8).map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => router.push(`/content/${item.id}`)}
                    style={styles.contentRow}
                  >
                    <View>
                      {item.contentType && (
                        <Badge label={item.contentType} variant="contentType" small />
                      )}
                      <Text variant="bodyMedium" style={styles.contentTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.sourceName && (
                        <Text variant="caption" color="muted">{item.sourceName}</Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {page.topUsers.length > 0 && (
              <View style={styles.section}>
                <Text variant="label" color="muted" style={styles.sectionLabel}>
                  People into {displayName}
                </Text>
                {page.topUsers.slice(0, 6).map((u) => (
                  <UserCard key={u.id} user={u} compact />
                ))}
              </View>
            )}

            {page.recentLogs.length === 0 && page.topContent.length === 0 && page.topUsers.length === 0 && (
              <EmptyState
                title={`No content for "${displayName}" yet`}
                body="Be the first to log something on this topic."
                ctaLabel="Log content"
                onCta={() => router.push('/compose/log')}
              />
            )}
          </>
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
  backBtn: { padding: Spacing[2] },
  navTitle: { flex: 1, textAlign: 'center' },
  scroll: { flex: 1 },
  content: { paddingBottom: Spacing[12] },
  header: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[6],
    alignItems: 'flex-start',
    gap: Spacing[3],
  },
  title: { textTransform: 'capitalize' },
  section: {
    paddingHorizontal: Spacing[6],
    marginBottom: Spacing[6],
  },
  sectionLabel: { marginBottom: Spacing[3] },
  contentRow: {
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  contentTitle: { marginTop: 4 },
});
