import React, { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import type {
  ContradictionCard,
  ThreadSynthesis,
  ConvergenceSignal,
  EvolutionArc,
  DormantThread,
  UserPosition,
} from '@/types/api';

function ContradictionCardView({
  card,
  onPressA,
  onPressB,
}: {
  card: ContradictionCard;
  onPressA: () => void;
  onPressB: () => void;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.contradictRow}>
        <Pressable
          style={[styles.contradictSide, { borderColor: c.borderSubtle }]}
          onPress={onPressA}
        >
          <Text variant="monoSmall" color="muted">A</Text>
          <Text variant="bodyMedium" numberOfLines={2} style={{ marginTop: 4 }}>
            {card.labelA}
          </Text>
          {!!card.previewA && (
            <Text variant="monoSmall" color="muted" numberOfLines={3} style={{ marginTop: 4 }}>
              {card.previewA}
            </Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.contradictSide, { borderColor: c.borderSubtle, borderRightWidth: 0 }]}
          onPress={onPressB}
        >
          <Text variant="monoSmall" color="muted">B</Text>
          <Text variant="bodyMedium" numberOfLines={2} style={{ marginTop: 4 }}>
            {card.labelB}
          </Text>
          {!!card.previewB && (
            <Text variant="monoSmall" color="muted" numberOfLines={3} style={{ marginTop: 4 }}>
              {card.previewB}
            </Text>
          )}
        </Pressable>
      </View>
      <View style={[styles.tensionRow, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="muted" style={styles.tensionLabel}>tension</Text>
        <Text variant="body" color="secondary" style={{ marginTop: Spacing[2] }}>
          {card.tension}
        </Text>
      </View>
    </View>
  );
}

function ThreadSynthesisView({
  synthesis,
  position,
}: {
  synthesis: ThreadSynthesis;
  position?: UserPosition;
}) {
  const c = useThemeColors();
  const router = useRouter();
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{synthesis.topicName}</Text>
        <Text variant="monoSmall" color="muted">{synthesis.captureCount} captures</Text>
      </View>
      <Text variant="bodyMedium" style={{ marginTop: Spacing[3], paddingHorizontal: Spacing[4] }}>
        {synthesis.position}
      </Text>
      <View style={[styles.openQuestionRow, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="muted" style={styles.openQuestionLabel}>open question</Text>
        <Text variant="monoSmall" color="secondary" style={{ marginTop: Spacing[2] }}>
          {synthesis.openQuestion}
        </Text>
      </View>
      <Pressable
        style={[styles.positionCta, { borderTopColor: c.borderSubtle }]}
        onPress={() => {
          if (position) {
            router.push({ pathname: '/position/[topicId]' as never, params: { topicId: synthesis.topicId } });
          } else {
            router.push({
              pathname: '/position/create' as never,
              params: {
                topicId: synthesis.topicId,
                topicName: synthesis.topicName,
                captureCount: String(synthesis.captureCount),
              },
            });
          }
        }}
      >
        <Text variant="monoSmall" color="muted">
          {position ? 'View position →' : 'Take a position →'}
        </Text>
      </Pressable>
    </View>
  );
}

function ConvergenceSignalView({ signal }: { signal: ConvergenceSignal }) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{signal.topicName}</Text>
        <Text variant="monoSmall" color="muted">{signal.sourceCount} sources</Text>
      </View>
      <Text variant="body" color="secondary" style={{ marginTop: Spacing[3], paddingHorizontal: Spacing[4], paddingBottom: Spacing[4] }}>
        {signal.signal}
      </Text>
    </View>
  );
}

function EvolutionArcView({ arc }: { arc: EvolutionArc }) {
  const c = useThemeColors();
  const maxCount = Math.max(1, ...arc.periods.map((p) => p.captureCount));

  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{arc.topicName}</Text>
        <Text variant="monoSmall" color="muted">{arc.captureCount} total</Text>
      </View>
      <View style={styles.arcRow}>
        {arc.periods.map((period) => (
          <View key={period.month} style={styles.arcPeriod}>
            <View
              style={[
                styles.arcBar,
                {
                  height: 4 + (period.captureCount / maxCount) * 32,
                  backgroundColor: c.text,
                },
              ]}
            />
            <Text variant="monoSmall" style={[styles.arcMonth, { color: c.faint }]}>
              {period.month.slice(5)}
            </Text>
          </View>
        ))}
      </View>
      {(arc.periods.at(-1)?.keyIdeas.length ?? 0) > 0 && (
        <Text variant="monoSmall" color="muted" style={{ paddingHorizontal: Spacing[4], paddingBottom: Spacing[4] }}>
          Recent: {arc.periods.at(-1)!.keyIdeas[0]}
        </Text>
      )}
    </View>
  );
}

function DormantThreadView({ thread }: { thread: DormantThread }) {
  const c = useThemeColors();
  return (
    <View style={[styles.dormantRow, { borderBottomColor: c.border }]}>
      <Text variant="bodyMedium">{thread.topicName}</Text>
      <Text variant="monoSmall" color="muted" style={{ marginTop: 4 }}>
        {thread.captureCount} captures · quiet for {thread.daysSilent} days
      </Text>
    </View>
  );
}

function PositionCard({
  position,
  onNavigate,
  onTakePosition,
}: {
  position?: UserPosition;
  onNavigate: () => void;
  onTakePosition?: () => void;
}) {
  const c = useThemeColors();
  const router = useRouter();
  const pending = position?.challenges.filter((ch) => !ch.acknowledged).length ?? 0;

  if (!position) {
    return (
      <Pressable
        style={[styles.card, styles.positionCta, { borderColor: c.border }]}
        onPress={onTakePosition}
      >
        <Text variant="bodyMedium">Take a position →</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.card, { borderColor: c.border }]}
      onPress={onNavigate}
    >
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{position.topic.name}</Text>
        {pending > 0 && (
          <Text variant="monoSmall" color="muted">{pending} challenge{pending !== 1 ? 's' : ''}</Text>
        )}
      </View>
      <Text variant="body" numberOfLines={3} style={{ marginTop: Spacing[3], paddingHorizontal: Spacing[4] }}>
        {position.statement}
      </Text>
      <View style={[styles.tensionRow, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="muted">
          {position.status === 'REVISED' ? 'Revised · ' : ''}{position.captureCountAtCreation} captures at creation
        </Text>
      </View>
      <Pressable
        onPress={() => router.push({ pathname: '/socratic/[topicId]' as never, params: { topicId: position.topicId } })}
        style={[styles.positionCta, { borderTopColor: c.borderSubtle }]}
      >
        <Text variant="monoSmall" color="muted">Open Socratic dialogue →</Text>
      </Pressable>
    </Pressable>
  );
}

export default function MindScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [infoVisible, setInfoVisible] = useState(false);
  const { data, loading, error, refetch } = useApiQuery(
    () => api.memory.intelligence(),
    [],
  );

  const { data: positions, refetch: refetchPositions } = useApiQuery(
    () => api.positions.list(),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void refetch();
      void refetchPositions();
    }, [refetch, refetchPositions]),
  );

  const positionByTopic = new Map((positions ?? []).map((p) => [p.topicId, p]));

  const isEmpty =
    !loading &&
    !error &&
    data !== null &&
    data !== undefined &&
    data.contradictionCards.length === 0 &&
    data.threadSyntheses.length === 0 &&
    data.convergenceSignals.length === 0 &&
    data.evolutionArcs.length === 0 &&
    data.dormantThreads.length === 0 &&
    (positions ?? []).length === 0;

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">mind</Text>
        </View>
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">mind</Text>
        </View>
        <EmptyState title="Mind unavailable" body={error} ctaLabel="Retry" onCta={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">mind</Text>
        <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About mind">
          <Text style={{ color: c.faint, fontSize: 16 }}>ⓘ</Text>
        </Pressable>
      </View>
      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="mind"
        body="Shows what's already sitting in your map: patterns you missed, ideas that contradict each other, threads that keep coming back. All of it comes from what you saved, not from prompts."
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={c.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        {isEmpty ? (
          <ScreenIntro
            title="Your mind is quiet for now"
            body="Save a few more things and patterns start showing up here: contradictions, repeats, and ideas that connect."
          />
        ) : (
          <Text variant="serif" color="secondary" style={styles.lead}>
            What you didn't know you know.
          </Text>
        )}

        {(data?.contradictionCards.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Tensions</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              Two things you hold that pull in opposite directions.
            </Text>
            {data!.contradictionCards.map((card) => (
              <ContradictionCardView
                key={`${card.itemAId}-${card.itemBId}`}
                card={card}
                onPressA={() => router.push(`/insight/${card.itemAId}` as never)}
                onPressB={() => router.push(`/insight/${card.itemBId}` as never)}
              />
            ))}
          </>
        )}

        {(positions ?? []).length > 0 && (
          <View>
            <Text variant="monoSmall" color="muted" style={styles.sectionHeader}>
              Positions
            </Text>
            {(positions ?? []).map((position) => (
              <PositionCard
                key={position.topicId}
                position={position}
                onNavigate={() =>
                  router.push({ pathname: '/position/[topicId]' as never, params: { topicId: position.topicId } })
                }
              />
            ))}
          </View>
        )}

        {(data?.threadSyntheses.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Threads</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              Where your thinking on these topics appears to have landed.
            </Text>
            {data!.threadSyntheses.map((synthesis) => (
              <ThreadSynthesisView
                key={synthesis.topicId}
                synthesis={synthesis}
                position={positionByTopic.get(synthesis.topicId)}
              />
            ))}
          </>
        )}

        {(data?.convergenceSignals.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Convergence</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              The same idea arriving from different directions.
            </Text>
            {data!.convergenceSignals.map((signal) => (
              <ConvergenceSignalView key={signal.topicId} signal={signal} />
            ))}
          </>
        )}

        {(data?.evolutionArcs.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Evolution</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              How your attention to these topics has changed over time.
            </Text>
            {data!.evolutionArcs.map((arc) => (
              <EvolutionArcView key={arc.topicId} arc={arc} />
            ))}
          </>
        )}

        {(data?.dormantThreads.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Dormant</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              Threads you went deep on, now sitting quiet.
            </Text>
            {data!.dormantThreads.map((thread) => (
              <DormantThreadView key={thread.topicId} thread={thread} />
            ))}
          </>
        )}
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
  content: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[16],
  },
  lead: {
    marginTop: Spacing[6],
    maxWidth: 320,
  },
  sectionHead: {
    marginTop: Spacing[10],
  },
  sectionSub: {
    marginTop: Spacing[2],
    marginBottom: Spacing[4],
    maxWidth: 320,
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.md,
    marginBottom: Spacing[4],
    overflow: 'hidden',
  },
  contradictRow: {
    flexDirection: 'row',
  },
  contradictSide: {
    flex: 1,
    padding: Spacing[4],
    borderRightWidth: 0.5,
  },
  tensionRow: {
    padding: Spacing[4],
    borderTopWidth: 1,
  },
  tensionLabel: {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  synthesisMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing[4],
    paddingBottom: 0,
  },
  openQuestionRow: {
    padding: Spacing[4],
    marginTop: Spacing[4],
    borderTopWidth: 1,
  },
  openQuestionLabel: {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  arcRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    height: 60,
  },
  arcPeriod: {
    alignItems: 'center',
    gap: 4,
  },
  arcBar: {
    width: 16,
    borderRadius: 2,
  },
  arcMonth: {
    fontSize: 9,
  },
  dormantRow: {
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  positionCta: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  sectionHeader: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: Spacing[10],
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[4],
  },
});
