import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { INK_ON_ACCENT, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

type Variant = 'topic' | 'contentType' | 'pill' | 'count' | 'edge';

interface Props {
  label: string;
  variant?: Variant;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
  /**
   * The subject's own colour, for a `topic` badge. A row of topic chips was
   * outline-on-nothing in the one grey the whole screen already used, so it
   * added a shape but no information; tinted, the chips say WHICH subjects at a
   * glance and match the dot the archive and the Atlas put beside the same
   * topic. Ignored by the other variants, which aren't about a subject.
   */
  accent?: string;
}

export function Badge({ label, variant = 'topic', selected = false, onPress, small = false, accent }: Props) {
  const c = useThemeColors();
  const box = useMemo(
    () => ({
      topic: {
        // A wash rather than a fill: eight of these can sit in one row.
        backgroundColor: accent ? `${accent}1A` : ('transparent' as const),
        borderColor: accent ? `${accent}66` : c.border,
      },
      contentType: {
        backgroundColor: 'transparent' as const,
        borderColor: c.border,
      },
      pill: {
        backgroundColor: c.borderSubtle,
        borderColor: 'transparent' as const,
      },
      count: {
        // The folder tiles' count chip. `inverse` is a near-black in light
        // mode, which put a dark dot on every folder in the grid — the same
        // colour the header band uses, doing a completely different job a
        // few hundred pixels below it. With an accent it belongs to its
        // folder instead.
        backgroundColor: accent ?? c.inverse,
        borderColor: 'transparent' as const,
      },
      edge: {
        backgroundColor: 'transparent' as const,
        borderColor: c.text,
        borderRadius: Radius.xs,
      },
      selected: {
        backgroundColor: accent ?? c.inverse,
        borderColor: accent ?? c.inverse,
      },
    }),
    [c, accent],
  );

  const inner = (
    <View
      style={[
        styles.base,
        box[variant],
        selected && box.selected,
        small && styles.small,
        variant === 'edge' && styles.edgePad,
      ]}
    >
      <Text
        variant="monoSmall"
        color={selected ? 'inverse' : 'secondary'}
        // The label takes the accent too, so the chip is one coloured object
        // rather than grey type in a coloured box. Not when `selected` — that
        // variant fills with `inverse`, and the accent would not clear it.
        style={[
          small ? styles.labelSmall : null,
          // On a filled accent the label has to clear the fill, not match it.
          accent ? { color: selected ? INK_ON_ACCENT : accent } : null,
        ]}
      >
        {variant === 'edge' ? label.toUpperCase() : label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
      >
        {inner}
      </Pressable>
    );
  }

  return inner;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
    borderWidth: 1,
  },
  edgePad: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    borderRadius: Radius.xs,
  },
  small: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
  },
  labelSmall: {
    fontSize: 10,
  },
});
