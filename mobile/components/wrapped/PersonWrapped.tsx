import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRightIcon } from 'lucide-react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import {
  ARCHETYPE_ICONS,
  ClockFace,
  DiscoveryTimeline,
  GATE_ARCHETYPE,
  GATE_FIELDS,
  GATE_NEW_TOPICS,
  GATE_RHYTHM,
  GATE_TOPICS,
  Spectrum,
  TopicBubbles,
} from './WrappedSection';
import { personArchetypeLine, personRhythmLine } from './copy';
import type { PersonWrapped as PersonWrappedStats } from '@/types/api';

function Card({ title, line, children }: { title: string; line?: string; children: React.ReactNode }) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { borderColor: c.border, backgroundColor: c.surface }]}>
      <Text variant="h4">{title}</Text>
      {!!line && (
        <Text variant="subheadline" color="secondary" style={styles.line}>
          {line}
        </Text>
      )}
      {children}
    </View>
  );
}

/**
 * A followed person's portrait: the same cards as the owner's You page, but
 * only the ones that say who someone is, said in the third person, and gated
 * on the same capture counts so a two-capture account doesn't get a "rhythm".
 * Shared ground with the viewer leads, because it is the part that is about
 * both of you.
 */
export function PersonWrapped({
  stats,
  name,
  accent,
  seed,
  onOpenCapture,
}: {
  stats: PersonWrappedStats;
  /** First name, for "Most of Ada's saves…". */
  name: string;
  accent: string;
  seed: number;
  onOpenCapture: (captureId: string) => void;
}) {
  const c = useThemeColors();
  const total = stats.totalCaptures;
  const { overlap } = stats;
  const archetype = personArchetypeLine(name, stats.formats[0]?.name, stats.formats[0]?.count ?? 0, total);
  const hasRhythm = stats.busiestHour !== null && stats.hourHistogram.length === 24;

  return (
    <View>
      {(overlap.topics.length > 0 || overlap.saves.length > 0) && (
        <Card
          title="In common"
          line={
            overlap.saveCount > 0
              ? `You have both saved ${overlap.saveCount} ${overlap.saveCount === 1 ? 'thing' : 'things'}.`
              : undefined
          }
        >
          {overlap.topics.length > 0 && (
            <View style={styles.chips}>
              {overlap.topics.map((topic) => (
                <Badge key={topic} label={topic} variant="topic" />
              ))}
            </View>
          )}
          {overlap.saves.map((save) => (
            <Pressable
              key={save.id}
              onPress={() => onOpenCapture(save.id)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.saveRow,
                { borderTopColor: c.borderSubtle, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text variant="body" numberOfLines={2} style={styles.saveTitle}>
                {save.title}
              </Text>
              <ChevronRightIcon size={16} color={c.muted} />
            </Pressable>
          ))}
        </Card>
      )}

      {stats.topFields.length > 0 && total >= GATE_FIELDS && (
        <Card title={`Where ${name} reads`}>
          <Spectrum items={stats.topFields} />
        </Card>
      )}

      {stats.topTopics.length > 0 && total >= GATE_TOPICS && (
        <Card title="Most saved topics">
          <View style={styles.spaced}>
            <TopicBubbles items={stats.topTopics} accent={accent} seed={seed} active />
          </View>
        </Card>
      )}

      {stats.recentNewTopics.length > 0 && total >= GATE_NEW_TOPICS && (
        <Card title="New lately">
          <DiscoveryTimeline items={stats.recentNewTopics} accent={accent} />
        </Card>
      )}

      {hasRhythm && total >= GATE_RHYTHM && (
        <Card title={`When ${name} saves`} line={personRhythmLine(name, stats.busiestHour!)}>
          <ClockFace hours={stats.hourHistogram} peakHour={stats.busiestHour!} active />
        </Card>
      )}

      {archetype && total >= GATE_ARCHETYPE && (
        <Card title={`How ${name} saves`}>
          <View style={styles.archetypeRow}>
            <View style={[styles.glyph, { borderColor: accent }]}>
              {React.createElement(ARCHETYPE_ICONS[archetype.format], {
                size: 24,
                color: accent,
                strokeWidth: 1.5,
              })}
            </View>
            <Text variant="body" style={styles.archetypeText}>
              {archetype.line}
            </Text>
          </View>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    marginBottom: Spacing[3],
    overflow: 'hidden',
  },
  line: { marginTop: Spacing[1] },
  spaced: { marginTop: Spacing[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginTop: Spacing[4] },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[3],
    marginTop: Spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveTitle: { flex: 1 },
  archetypeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[5], marginTop: Spacing[4] },
  glyph: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archetypeText: { flex: 1 },
});
