import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';

export default function TrendsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [windowKey, setWindowKey] = useState<'week' | 'month'>('week');
  const { data, loading, error, refetch } = useApiQuery(
    () => api.memory.trends({ window: windowKey }),
    [windowKey],
  );

  const onRefresh = useCallback(() => void refetch(), [refetch]);

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">Drift</Text>
        </View>
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <EmptyState title="Trends unavailable" ctaLabel="Retry" onCta={refetch} />
      </SafeAreaView>
    );
  }

  const maxSpark = Math.max(1, ...data.sparkline.map((s) => s.count));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">Drift</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.text} />}
      >
        <View style={styles.windowToggle}>
          {(['week', 'month'] as const).map((w) => (
            <Pressable
              key={w}
              onPress={() => setWindowKey(w)}
              style={[
                styles.toggleBtn,
                {
                  borderColor: c.border,
                  backgroundColor: windowKey === w ? c.elevated : 'transparent',
                },
              ]}
            >
              <Text variant="monoSmall" color={windowKey === w ? 'primary' : 'muted'}>
                {w === 'week' ? '7d' : '30d'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text variant="serif" color="secondary" style={styles.lead}>
          {data.captureCount} captures in view. What your mind keeps returning to.
        </Text>

        <View style={[styles.sparkCard, { borderColor: c.border }]}>
          <Text variant="label" color="muted" style={{ marginBottom: Spacing[3] }}>
            Cadence
          </Text>
          <View style={styles.sparkRow}>
            {data.sparkline.map((s) => (
              <View
                key={s.day}
                style={[
                  styles.bar,
                  {
                    height: 4 + (s.count / maxSpark) * 36,
                    backgroundColor: s.count > 0 ? c.text : c.borderSubtle,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <Text variant="h3" style={{ marginTop: Spacing[8] }}>
          Shifts
        </Text>
        {data.shifts.length === 0 ? (
          <Text variant="body" color="muted" style={{ marginTop: Spacing[2] }}>
            No directional change yet. More captures will surface contrast.
          </Text>
        ) : (
          data.shifts.map((t) => (
            <View key={t.topicId} style={[styles.themeRow, { borderBottomColor: c.border }]}>
              <Text variant="bodyMedium">{t.name}</Text>
              <Text variant="monoSmall" color="muted">
                Δ {t.delta > 0 ? '+' : ''}{t.delta}
              </Text>
            </View>
          ))
        )}

        <Text variant="h3" style={{ marginTop: Spacing[8] }}>
          Recurrent
        </Text>
        {data.recurring.map((t) => (
          <View key={t.topicId} style={[styles.themeRow, { borderBottomColor: c.border }]}>
            <Badge label={t.name} variant="topic" />
            <Text variant="monoSmall" color="muted">
              {t.total} touches
            </Text>
          </View>
        ))}

        <Text variant="h3" style={{ marginTop: Spacing[8] }}>
            Events
        </Text>
        {data.events.length === 0 ? (
          <Text variant="body" color="muted" style={{ marginTop: Spacing[2] }}>
            No contradiction or topic-shift events logged in this window.
          </Text>
        ) : (
          data.events.map((ev) => (
            <Pressable
              key={ev.id}
              style={[styles.ev, { borderColor: c.border }]}
              onPress={() => {
                const p = ev.payload as { capturedItemId?: string } | null;
                if (p?.capturedItemId) router.push(`/insight/${p.capturedItemId}` as never);
              }}
            >
              <Text variant="monoSmall" color="muted">
                {ev.type}
              </Text>
              <Text variant="caption" color="secondary" style={{ marginTop: 4 }} numberOfLines={3}>
                {JSON.stringify(ev.payload)}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  content: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[16] },
  windowToggle: { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[4] },
  toggleBtn: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  lead: { marginTop: Spacing[4], maxWidth: 340 },
  sparkCard: {
    marginTop: Spacing[6],
    padding: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  sparkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 44,
    gap: 2,
  },
  bar: { flex: 1, borderRadius: 1 },
  themeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  ev: {
    marginTop: Spacing[3],
    padding: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
});
