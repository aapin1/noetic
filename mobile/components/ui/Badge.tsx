import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';

type Variant = 'topic' | 'contentType' | 'pill' | 'count';

interface Props {
  label: string;
  variant?: Variant;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
}

export function Badge({ label, variant = 'topic', selected = false, onPress, small = false }: Props) {
  const inner = (
    <View
      style={[
        styles.base,
        styles[variant],
        selected && styles.selected,
        small && styles.small,
      ]}
    >
      <Text style={[styles.label, selected && styles.labelSelected, small && styles.labelSmall]}>
        {label}
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
    paddingVertical: Spacing[1],
    borderWidth: 1,
  },
  topic: {
    backgroundColor: Colors.accentGoldLight,
    borderColor: 'rgba(200,165,91,0.2)',
  },
  contentType: {
    backgroundColor: Colors.accentVioletLight,
    borderColor: 'rgba(140,123,255,0.2)',
  },
  pill: {
    backgroundColor: Colors.elevatedSurface,
    borderColor: Colors.cardBorder,
  },
  count: {
    backgroundColor: Colors.accentGold,
    borderColor: 'transparent',
    minWidth: 20,
    alignItems: 'center',
  },
  selected: {
    backgroundColor: Colors.accentGold,
    borderColor: Colors.accentGold,
  },
  small: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
  },
  label: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.xs,
    color: Colors.secondaryText,
    letterSpacing: 0.2,
  },
  labelSelected: {
    color: Colors.primaryText,
  },
  labelSmall: {
    fontSize: 10,
  },
});
