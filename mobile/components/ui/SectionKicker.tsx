import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';

/**
 * The title that names a block of a screen, the way a grouped iOS list names
 * its sections: title 3, semibold, sentence case, no eyebrow, no tick. An
 * optional trailing action ("See all") sits on the same baseline.
 *
 * `accent` is accepted for compatibility with older call sites and ignored:
 * a section header carries weight, not colour.
 */
export function SectionKicker({
  label,
  action,
  style,
}: {
  label: string;
  accent?: string;
  action?: React.ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.row, style]}>
      <Text variant="h4" style={styles.title} numberOfLines={1}>
        {label}
      </Text>
      {action}
    </View>
  );
}

export const SectionTitle = SectionKicker;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing[3],
  },
  title: { flexShrink: 1 },
});
