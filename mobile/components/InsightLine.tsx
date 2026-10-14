import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { plainProse, sentenceCase } from '@/lib/text';
import type { InsightCard, InsightType } from '@/types/api';

const TYPE_LABEL: Record<InsightType, string> = {
  PATTERN: 'Pattern',
  TRAJECTORY: 'Trajectory',
  CONNECTION: 'Connection',
  REINFORCES: 'Reinforces',
  CONTRADICTS: 'Contradicts',
  NOVELTY: 'Novelty',
  RECUR: 'Recurs',
  READING: 'Reading',
  MIRROR: 'A read on you',
};

interface Props {
  insight: InsightCard;
  compact?: boolean;
}

/**
 * One insight: a small type label, the line itself, and (for a READING) the
 * note the model made on it, titled by the move it chose. No meters, no
 * decoration; the type label is the only metadata.
 */
export function InsightLine({ insight, compact = false }: Props) {
  const c = useThemeColors();
  // Every polished insight names the move it made in evidence.kicker: the
  // READING's note ("the catch", "where it comes from") and the graph-derived
  // kinds too ("what it adds", "where they split"). The MIRROR carries none;
  // its label is the type itself.
  const rawKicker = insight.type !== 'MIRROR'
    ? (insight.evidence as { kicker?: unknown } | null)?.kicker
    : undefined;
  const noteKicker = typeof rawKicker === 'string' && rawKicker.trim() ? sentenceCase(rawKicker.trim()) : null;

  const border = useMemo(() => ({ borderTopColor: c.borderSubtle }), [c]);

  return (
    <View style={[styles.container, compact && styles.compact, border]}>
      <Text variant="caption" color="muted" style={styles.type}>
        {TYPE_LABEL[insight.type]}
      </Text>
      <Text variant={compact ? 'bodyMedium' : 'bodySemiBold'} color="primary">
        {plainProse(insight.headline)}
      </Text>
      {!compact && insight.body && noteKicker ? (
        <Text variant="subheadline" color="muted" style={styles.noteLabel}>
          {noteKicker}
        </Text>
      ) : null}
      {!compact && insight.body ? (
        <Text variant="body" color="secondary" style={styles.body}>
          {plainProse(insight.body)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  compact: {
    paddingVertical: Spacing[3],
  },
  type: {
    marginBottom: Spacing[1],
  },
  noteLabel: {
    marginTop: Spacing[3],
  },
  body: {
    marginTop: Spacing[1],
  },
});
