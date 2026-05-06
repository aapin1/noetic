import React, { useCallback, useMemo } from 'react';
import {
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Circle, G, Line } from 'react-native-svg';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';

const W = Dimensions.get('window').width - Spacing[6] * 2;
const H = 320;

function layoutRadial(
  ids: string[],
): Record<string, { x: number; y: number }> {
  const map: Record<string, { x: number; y: number }> = {};
  const n = ids.length;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) * 0.36;
  ids.forEach((id, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    map[id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return map;
}

export default function MemoryScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { data, loading, error, refetch } = useApiQuery(() => api.memory.graph({ limit: 60 }), []);

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const pos = useMemo(() => layoutRadial(nodes.map((n) => n.id)), [nodes]);

  const onRefresh = useCallback(() => void refetch(), [refetch]);

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">Memory</Text>
        </View>
        <SkeletonCard />
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <EmptyState title="Graph unavailable" body="Check connectivity." ctaLabel="Retry" onCta={refetch} />
      </SafeAreaView>
    );
  }

  if (nodes.length === 0) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">Memory</Text>
        </View>
        <EmptyState
          title="Empty graph"
          body="Your captures form nodes here. One save starts the map."
          ctaLabel="Capture"
          onCta={() => router.push('/(tabs)')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">Memory</Text>
      </View>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.text} />}
        contentContainerStyle={styles.content}
      >
        <Text variant="serif" color="secondary" style={styles.intro}>
          Sparse map of what you have committed. Tap a node to open its insight.
        </Text>
        <View style={[styles.graphWrap, { borderColor: c.border }]}>
          <Svg width={W} height={H}>
            <G>
              {edges.map((e, i) => {
                const a = pos[e.fromItemId];
                const b = pos[e.toItemId];
                if (!a || !b) return null;
                return (
                  <Line
                    key={`e-${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={c.graphLine}
                    strokeWidth={0.8}
                    strokeOpacity={0.35 + e.weight * 0.5}
                  />
                );
              })}
              {nodes.map((n) => {
                const p = pos[n.id];
                if (!p) return null;
                return (
                  <Circle
                    key={n.id}
                    cx={p.x}
                    cy={p.y}
                    r={5}
                    fill={c.graphNode}
                    fillOpacity={0.92}
                  />
                );
              })}
            </G>
          </Svg>
        </View>

        <View style={styles.list}>
          {nodes.slice(0, 12).map((n) => (
            <Pressable
              key={n.id}
              onPress={() => router.push(`/insight/${n.id}` as never)}
              style={[styles.row, { borderBottomColor: c.border }]}
            >
              <Text variant="bodyMedium" numberOfLines={2}>
                {n.label}
              </Text>
              <Text variant="monoSmall" color="muted" style={{ marginTop: 4 }}>
                {n.kind}
              </Text>
            </Pressable>
          ))}
        </View>
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
  content: { paddingBottom: Spacing[16] },
  intro: { paddingHorizontal: Spacing[6], marginTop: Spacing[4], maxWidth: 340 },
  graphWrap: {
    marginHorizontal: Spacing[6],
    marginTop: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  list: { marginTop: Spacing[6], paddingHorizontal: Spacing[6] },
  row: { paddingVertical: Spacing[4], borderBottomWidth: 1 },
});
