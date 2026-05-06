import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

type Variant = 'topic' | 'contentType' | 'pill' | 'count' | 'edge';

interface Props {
  label: string;
  variant?: Variant;
  selected?: boolean;
  onPress?: () => void;
  small?: boolean;
}

export function Badge({ label, variant = 'topic', selected = false, onPress, small = false }: Props) {
  const c = useThemeColors();
  const box = useMemo(
    () => ({
      topic: {
        backgroundColor: 'transparent' as const,
        borderColor: c.border,
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
        backgroundColor: c.inverse,
        borderColor: 'transparent' as const,
      },
      edge: {
        backgroundColor: 'transparent' as const,
        borderColor: c.text,
        borderRadius: Radius.xs,
      },
      selected: {
        backgroundColor: c.inverse,
        borderColor: c.inverse,
      },
    }),
    [c],
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
        style={small ? styles.labelSmall : undefined}
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
