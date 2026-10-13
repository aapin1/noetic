import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { InsightCard, InsightType } from '@/types/api';

const TYPE_LABEL: Record<InsightType, string> = {
  PATTERN: 'pattern',
  TRAJECTORY: 'trajectory',
  CONNECTION: 'connection',
  REINFORCES: 'reinforces',
  CONTRADICTS: 'contradicts',
  NOVELTY: 'novelty',
  RECUR: 'recur',
  READING: 'reading',
  MIRROR: 'a read on you',
};

interface Props {
  insight: InsightCard;
  compact?: boolean;
}

export function InsightLine({ insight, compact = false }: Props) {
  const c = useThemeColors();
  const strengthBars = Math.max(1, Math.min(4, Math.round(insight.strength * 4)));
  // Every polished insight names the move it made in evidence.kicker — the
  // READING's note ("the catch", "where it comes from") and, since the
  // connection rewrite, the graph-derived kinds too ("what it adds", "where
  // they split"). The MIRROR carries none: its label is the type itself.
  const rawKicker = insight.type !== 'MIRROR'
    ? (insight.evidence as { kicker?: unknown } | null)?.kicker
    : undefined;
  const noteKicker = typeof rawKicker === 'string' && rawKicker.trim() ? rawKicker.trim() : null;

  const barStyles = useMemo(
    () =>
      StyleSheet.create({
        bar: { backgroundColor: c.borderSubtle },
        barFilled: { backgroundColor: c.text },
        border: { borderTopColor: c.border },
      }),
    [c],
  );

  return (
    <View style={[styles.container, compact && styles.compact, barStyles.border]}>
      <View style={styles.meta}>
        <Text variant="label" color="muted">
          {TYPE_LABEL[insight.type]}
        </Text>
        <View style={styles.strength}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <View
              key={idx}
              style={[styles.strengthBar, barStyles.bar, idx < strengthBars && barStyles.barFilled]}
            />
          ))}
        </View>
      </View>
      <Text variant={compact ? 'serif' : 'serifLg'} color="primary" style={styles.headline}>
        {insight.headline}
      </Text>
      {/* An insight is a line and then a move made on it — the catch, where it
          comes from, what it adds, where they split — and it names its own
          move in evidence.kicker. That name labels the note, so the two read
          as a pair rather than as a headline with a sentence under it, and
          the label is whatever this insight chose, not one fixed heading. */}
      {!compact && insight.body && noteKicker ? (
        <Text variant="label" color="muted" style={styles.noteLabel}>
          {noteKicker}
        </Text>
      ) : null}
      {!compact && insight.body ? (
        <Text variant="body" color="secondary" style={styles.body}>
          {insight.body}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing[5],
    borderTopWidth: 1,
  },
  compact: {
    paddingVertical: Spacing[4],
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[2],
  },
  strength: {
    flexDirection: 'row',
    gap: 3,
  },
  strengthBar: {
    width: 10,
    height: 2,
  },
  headline: {},
  noteLabel: {
    marginTop: Spacing[3],
  },
  body: {
    marginTop: Spacing[2],
  },
});
