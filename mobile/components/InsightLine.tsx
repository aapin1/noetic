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
};

interface Props {
  insight: InsightCard;
  compact?: boolean;
}

export function InsightLine({ insight, compact = false }: Props) {
  const c = useThemeColors();
  const strengthBars = Math.max(1, Math.min(4, Math.round(insight.strength * 4)));

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
  body: {
    marginTop: Spacing[2],
  },
});
