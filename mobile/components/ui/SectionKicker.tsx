import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';

/**
 * The label that names a block of a screen: a short tick in the block's accent,
 * then the name in tracked mono.
 *
 * These used to be plain `label`/`muted` text floating above a card — "your
 * mneme, wrapped", "share" — which is to say they were the only thing on the
 * page not participating in the colour-plus-mark grammar everything else uses
 * (a region on the Atlas, a topic in the archive, a section on an insight).
 * Grey type on the page above a card doesn't read as that card's title; it
 * reads as a stray line someone forgot to style.
 *
 * A tick rather than a dot: it sits beside tracked-out upper case, where a dot
 * reads as punctuation and a bar reads as a rule.
 */
export function SectionKicker({
  label,
  accent,
  style,
}: {
  label: string;
  accent: string;
  style?: object;
}) {
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.tick, { backgroundColor: accent }]} />
      <Text variant="label" style={{ color: accent }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tick: { width: 12, height: 2, borderRadius: 1, marginRight: Spacing[2] },
});
