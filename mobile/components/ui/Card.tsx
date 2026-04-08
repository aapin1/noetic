import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';

type Variant = 'default' | 'elevated' | 'flat';

interface Props extends ViewProps {
  variant?: Variant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ variant = 'default', padding = 'md', style, children, ...props }: Props) {
  return (
    <View
      style={[
        styles.base,
        styles[variant],
        padding !== 'none' && styles[`padding_${padding}`],
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
    borderRadius: Radius['3xl'],
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  default: {
    backgroundColor: Colors.surface,
    ...Shadow.soft,
  },
  elevated: {
    backgroundColor: Colors.elevatedSurface,
    ...Shadow.medium,
  },
  flat: {
    backgroundColor: Colors.surface,
  },

  padding_sm: {
    padding: Spacing[3],
  },
  padding_md: {
    padding: Spacing[5],
  },
  padding_lg: {
    padding: Spacing[6],
  },
});
