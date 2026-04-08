import React from 'react';
import { Text as RNText, TextProps, StyleSheet } from 'react-native';
import { Colors, FontFamily, FontSize, LineHeight } from '@/constants/theme';

type Variant =
  | 'hero'
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'body'
  | 'bodyMedium'
  | 'bodySemiBold'
  | 'bodyBold'
  | 'caption'
  | 'mono'
  | 'monoSmall'
  | 'label';

type Color = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'success' | 'white' | 'violet';

interface Props extends TextProps {
  variant?: Variant;
  color?: Color;
}

const variantStyles: Record<Variant, object> = {
  hero: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['5xl'],
    lineHeight: FontSize['5xl'] * LineHeight.tight,
    letterSpacing: -1.5,
  },
  display: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['4xl'],
    lineHeight: FontSize['4xl'] * LineHeight.tight,
    letterSpacing: -1,
  },
  h1: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['3xl'],
    lineHeight: FontSize['3xl'] * LineHeight.snug,
    letterSpacing: -0.5,
  },
  h2: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['2xl'],
    lineHeight: FontSize['2xl'] * LineHeight.snug,
    letterSpacing: -0.3,
  },
  h3: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.xl,
    lineHeight: FontSize.xl * LineHeight.snug,
  },
  h4: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.md,
    lineHeight: FontSize.md * LineHeight.normal,
    letterSpacing: 0.1,
  },
  body: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * LineHeight.relaxed,
  },
  bodyMedium: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * LineHeight.normal,
  },
  bodySemiBold: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * LineHeight.normal,
  },
  bodyBold: {
    fontFamily: FontFamily.bodyBold,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * LineHeight.normal,
  },
  caption: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    lineHeight: FontSize.sm * LineHeight.normal,
  },
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    lineHeight: FontSize.sm * LineHeight.normal,
    letterSpacing: 0.2,
  },
  monoSmall: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    lineHeight: FontSize.xs * LineHeight.normal,
    letterSpacing: 0.2,
  },
  label: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: FontSize.xs,
    lineHeight: FontSize.xs * LineHeight.normal,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
};

const colorMap: Record<Color, string> = {
  primary: Colors.primaryText,
  secondary: Colors.secondaryText,
  muted: Colors.mutedText,
  accent: Colors.accentGold,
  danger: Colors.danger,
  success: Colors.success,
  white: Colors.white,
  violet: Colors.accentViolet,
};

export function Text({ variant = 'body', color = 'primary', style, ...props }: Props) {
  return (
    <RNText
      style={[variantStyles[variant], { color: colorMap[color] }, style]}
      {...props}
    />
  );
}

export const styles = StyleSheet.create({});
