import React, { useMemo } from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

type Variant = 'default' | 'elevated' | 'flat' | 'hairline';

interface Props extends ViewProps {
  variant?: Variant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ variant = 'default', padding = 'md', style, children, ...props }: Props) {
  const c = useThemeColors();
  const variantStyle = useMemo(() => {
    switch (variant) {
      case 'flat':
        return { backgroundColor: 'transparent' };
      case 'hairline':
        return {
          backgroundColor: 'transparent',
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: c.border,
          borderRadius: 0,
        };
      default:
        return {
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.border,
        };
    }
  }, [c, variant]);

  return (
    <View
      style={[
        styles.base,
        variantStyle,
        padding !== 'none' && padStyles[`padding_${padding}`],
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
  },
});

const padStyles = StyleSheet.create({
  padding_sm: { padding: Spacing[3] },
  padding_md: { padding: Spacing[5] },
  padding_lg: { padding: Spacing[6] },
});
