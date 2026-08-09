import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionKicker } from '@/components/ui/SectionKicker';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type { StreakSummary } from '@/types/api';

/**
 * The daily ritual: one old capture handed back, its strongest thread, and a
 * way to pull it. Under two minutes by design — no feed, no backlog, nothing
 * to catch up on. Opening it counts as streak activity for the day (the visit
 * call below), the same unit a capture earns.
 */

function Section({
  kicker,
  accent,
  children,
}: {
  kicker: string;
  accent: string;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>
      <SectionKicker label={kicker} accent={accent} style={styles.kicker} />
      {children}
    </View>
  );
}

function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <Text variant="monoSmall" color="muted" style={styles.action}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function TodayScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { data, loading, refetch } = useApiQuery(() => api.today.get(), [], { cacheKey: 'today' });

  // "Hold" answers the challenge in place; the refetch clears the takeover.
  const [holding, setHolding] = useState(false);
  const holdPosition = async (challengeId: string) => {
    if (holding) return;
    setHolding(true);
    try {
      await api.positions.acknowledge(challengeId);
      await refetch();
    } catch {
      // Leave the challenge standing — it is still true.
    } finally {
      setHolding(false);
    }
  };

  // Opening the screen is the activity — credit it once per mount, quietly.
  // The response carries the fresh summary so the footer can tell the truth.
  const visitedRef = useRef(false);
  const [credited, setCredited] = useState(false);
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  useEffect(() => {
    if (visitedRef.current) return;
    visitedRef.current = true;
    void api.today
      .visit()
      .then((res) => {
        setCredited(res.credited);
        setStreak(res.streak);
      })
      .catch(() => {});
  }, []);

  const challenge = data?.challenge ?? null;
  const collision = data?.collision ?? null;
  const capture = data?.capture ?? null;
  const connection = data?.connection ?? null;

  const openCompanion = () => {
    if (!capture) return;
    const ids = [capture.id, ...(connection ? [connection.itemId] : [])].join(',');
    const labels = [capture.title, ...(connection ? [connection.title] : [])].join(',');
    router.push({
      pathname: '/companion',
      params: connection
        ? { contextIds: ids, contextLabels: labels, connections: `${capture.title} ~ ${connection.title}` }
        : { contextIds: ids, contextLabels: labels },
    } as never);
  };

  const streakLine = (() => {
    if (!streak) return null;
    if (credited) {
      return streak.current >= 2
        ? `◆ ${streak.current} days running — opening this counted.`
        : 'opening this counted toward today.';
    }
    return streak.current >= 2 ? `◆ ${streak.current} days running.` : null;
  })();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="today" variant="title" />

      {loading && !data ? (
        <AsciiLoader fill size={72} message={['leafing back…', 'finding the thread…']} />
      ) : !capture && !challenge && !collision ? (
        <View style={styles.empty}>
          <Text variant="serif" color="muted" style={styles.emptyTitle}>
            not yet
          </Text>
          <Text variant="monoSmall" color="faint" style={styles.emptyBody}>
            today opens once your map has a little history — a week of saves is enough. keep
            charting.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {challenge ? (
            <Section kicker="your position, challenged" accent={Accents.clay}>
              <Text variant="monoSmall" color="faint" style={styles.whyNow}>
                you staked this on {challenge.topicName.toLowerCase()}:
              </Text>
              <Text variant="h3" style={styles.title}>
                “{challenge.statement}”
              </Text>
              {challenge.capture ? (
                <Text variant="monoSmall" color="faint" style={styles.reaction}>
                  now colliding with: {challenge.capture.title}
                </Text>
              ) : null}
              <Text variant="body" color="muted" style={styles.idea}>
                {challenge.tension}
              </Text>
              <View style={styles.actions}>
                <ActionRow
                  label="revise position →"
                  onPress={() => router.push(`/position/${challenge.topicId}` as never)}
                />
                <ActionRow
                  label={holding ? 'holding…' : 'hold position'}
                  onPress={() => void holdPosition(challenge.challengeId)}
                />
              </View>
            </Section>
          ) : null}

          {collision ? (
            <Section kicker="two saves disagree" accent={Accents.clay}>
              <Text variant="bodyMedium" numberOfLines={3}>
                {collision.itemA.title}
              </Text>
              <Text variant="monoSmall" color="faint" style={styles.edgeType}>
                — pulls against —
              </Text>
              <Text variant="bodyMedium" numberOfLines={3}>
                {collision.itemB.title}
              </Text>
              <View style={styles.actions}>
                <ActionRow
                  label="see where they split →"
                  onPress={() => router.push(`/insight/${collision.itemA.id}?from=today` as never)}
                />
              </View>
            </Section>
          ) : null}

          {capture ? (
          <Section kicker="resurfaced" accent={Accents.amber}>
            <Text variant="monoSmall" color="faint" style={styles.whyNow}>
              {capture.whyNow}
            </Text>
            <Text variant="h3" style={styles.title}>
              {capture.title}
            </Text>
            {capture.keyIdea ? (
              <Text variant="body" color="muted" style={styles.idea}>
                {capture.keyIdea}
              </Text>
            ) : null}
            {capture.reaction ? (
              <Text variant="monoSmall" color="faint" style={styles.reaction}>
                you said: {capture.reaction}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <ActionRow
                label="open insight →"
                onPress={() => router.push(`/insight/${capture.id}?from=today` as never)}
              />
              <ActionRow
                label="view in atlas →"
                onPress={() =>
                  router.navigate({ pathname: '/(tabs)', params: { selectIds: capture.id } } as never)
                }
              />
              <ActionRow label="continue in companion →" onPress={openCompanion} />
            </View>
          </Section>
          ) : null}

          {capture && connection ? (
            <Section kicker="these two touch" accent={Accents.moss}>
              <Text variant="bodyMedium" numberOfLines={3}>
                {capture.title}
              </Text>
              <Text variant="monoSmall" color="faint" style={styles.edgeType}>
                — {connection.type.toLowerCase()} —
              </Text>
              <Text variant="bodyMedium" numberOfLines={3}>
                {connection.title}
              </Text>
              <View style={styles.actions}>
                <ActionRow label="pull the thread →" onPress={openCompanion} />
                <ActionRow
                  label="see the other side →"
                  onPress={() => router.push(`/insight/${connection.itemId}?from=today` as never)}
                />
              </View>
            </Section>
          ) : null}

          {streakLine ? (
            <Text variant="monoSmall" color="faint" style={styles.streakLine}>
              {streakLine}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingVertical: Spacing[5], paddingBottom: Spacing[12] },
  section: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    marginHorizontal: Spacing[4],
    marginBottom: Spacing[4],
  },
  kicker: { marginBottom: Spacing[3] },
  whyNow: { marginBottom: Spacing[2] },
  title: { marginBottom: Spacing[2] },
  idea: { marginBottom: Spacing[2], lineHeight: 22 },
  reaction: { marginBottom: Spacing[1] },
  actions: { marginTop: Spacing[3], gap: Spacing[3] },
  action: { letterSpacing: 0.5 },
  edgeType: { marginVertical: Spacing[2] },
  streakLine: { textAlign: 'center', marginTop: Spacing[2], paddingHorizontal: Spacing[6] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing[8] },
  emptyTitle: { marginBottom: Spacing[3] },
  emptyBody: { textAlign: 'center', lineHeight: 20 },
});
