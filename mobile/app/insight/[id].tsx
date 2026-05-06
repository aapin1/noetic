import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeftIcon, ExternalLinkIcon } from 'lucide-react-native';
import { Image } from 'expo-image';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { InsightLine } from '@/components/InsightLine';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';

export default function InsightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useThemeColors();
  const router = useRouter();

  const { data, loading, error, refetch } = useApiQuery(() => api.captures.get(id), [id]);

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.nav, { borderBottomColor: c.border }]}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <ChevronLeftIcon size={22} color={c.text} />
          </Pressable>
        </View>
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <EmptyState title="Insight not found" ctaLabel="Back" onCta={() => router.back()} />
      </SafeAreaView>
    );
  }

  const url = data.contentItem?.canonicalUrl ?? null;
  const title = data.title;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.nav, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="monoSmall" color="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          Committed
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {data.contentItem?.imageUrl ? (
          <Image
            source={{ uri: data.contentItem.imageUrl }}
            style={styles.cover}
            contentFit="cover"
          />
        ) : null}
        {data.mediaUrl && data.kind === 'IMAGE' ? (
          <Image source={{ uri: data.mediaUrl }} style={styles.cover} contentFit="cover" />
        ) : null}

        <View style={styles.block}>
          <View style={styles.badges}>
            <Badge label={data.kind} variant="edge" />
            {data.topics.slice(0, 4).map((t) => (
              <Badge key={t.topicId} label={t.name} variant="topic" />
            ))}
          </View>
          <Text variant="h2">{title}</Text>
          {data.summary ? (
            <Text variant="serif" color="secondary" style={{ marginTop: Spacing[4] }}>
              {data.summary}
            </Text>
          ) : null}
          {data.keyIdea ? (
            <Text variant="h4" style={{ marginTop: Spacing[5] }}>
              Core idea
            </Text>
          ) : null}
          {data.keyIdea ? (
            <Text variant="serif" color="secondary" style={{ marginTop: Spacing[2] }}>
              {data.keyIdea}
            </Text>
          ) : null}
          {url ? (
            <Pressable
              onPress={() => Linking.openURL(url)}
              style={[styles.linkRow, { marginTop: Spacing[4] }]}
              accessibilityRole="link"
            >
              <ExternalLinkIcon size={14} color={c.text} />
              <Text variant="monoSmall" color="primary" style={{ marginLeft: 6 }}>
                Source
              </Text>
            </Pressable>
          ) : null}
          {data.rawText && !data.summary ? (
            <Text variant="body" color="secondary" style={{ marginTop: Spacing[4] }}>
              {data.rawText}
            </Text>
          ) : null}
          {data.reaction ? (
            <Card variant="hairline" padding="md" style={{ marginTop: Spacing[6] }}>
              <Text variant="label" color="muted">
                Your reaction
              </Text>
              <Text variant="serif" style={{ marginTop: Spacing[2] }}>
                {data.reaction}
              </Text>
            </Card>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text variant="h3">Insight</Text>
          {data.insights.map((ins) => (
            <InsightLine key={ins.id} insight={ins} />
          ))}
        </View>

        <View style={styles.section}>
          <Text variant="h3">Connected memory</Text>
          {data.related.length === 0 ? (
            <Text variant="body" color="muted" style={{ marginTop: Spacing[2] }}>
              First node: connections appear as you add more.
            </Text>
          ) : (
            data.related.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/insight/${r.id}` as never)}
                style={[styles.rel, { borderColor: c.border }]}
              >
                {r.edgeType ? <Badge label={r.edgeType} variant="edge" small /> : null}
                <Text variant="bodyMedium" style={{ marginTop: Spacing[2] }} numberOfLines={3}>
                  {r.title}
                </Text>
              </Pressable>
            ))
          )}
        </View>
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
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
  },
  back: { padding: Spacing[2] },
  content: { paddingBottom: Spacing[16] },
  cover: { width: '100%', height: 200, backgroundColor: 'transparent' },
  block: { paddingHorizontal: Spacing[6], paddingTop: Spacing[6] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginBottom: Spacing[3] },
  linkRow: { flexDirection: 'row', alignItems: 'center' },
  section: { paddingHorizontal: Spacing[6], marginTop: Spacing[8] },
  rel: {
    marginTop: Spacing[4],
    padding: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
});
