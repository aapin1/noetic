import React, { useMemo } from 'react';
import { Text as RNText, TextProps, StyleSheet } from 'react-native';
import { FontFamily, FontSize, LetterSpacing, LineHeight } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

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
  | 'caption'
  | 'mono'
  | 'monoSmall'
  | 'label'
  | 'serif'
  | 'serifLg'
  | 'wordmark';

type Color = 'primary' | 'secondary' | 'muted' | 'faint' | 'accent' | 'danger' | 'inverse';

interface Props extends TextProps {
  variant?: Variant;
  color?: Color;
}

const variantStyles: Record<Variant, object> = {
  hero: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize.display,
    lineHeight: FontSize.display * LineHeight.tight,
    letterSpacing: LetterSpacing.tight,
  },
  display: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize['4xl'],
    lineHeight: FontSize['4xl'] * LineHeight.tight,
    letterSpacing: LetterSpacing.tight,
  },
  h1: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize['3xl'],
    lineHeight: FontSize['3xl'] * LineHeight.snug,
    letterSpacing: LetterSpacing.tight,
  },
  h2: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize['2xl'],
    lineHeight: FontSize['2xl'] * LineHeight.snug,
    letterSpacing: LetterSpacing.tight,
  },
  h3: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize.xl,
    lineHeight: FontSize.xl * LineHeight.snug,
  },
  h4: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize.lg,
    lineHeight: FontSize.lg * LineHeight.snug,
  },
  serif: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize.md,
    lineHeight: FontSize.md * LineHeight.relaxed,
  },
  serifLg: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize.lg,
    lineHeight: FontSize.lg * LineHeight.relaxed,
  },
  body: {
    fontFamily: FontFamily.sans,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * LineHeight.relaxed,
  },
  bodyMedium: {
    fontFamily: FontFamily.sansMedium,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * LineHeight.normal,
    fontWeight: '500' as const,
  },
  bodySemiBold: {
    fontFamily: FontFamily.sansMedium,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * LineHeight.normal,
    fontWeight: '600' as const,
  },
  caption: {
    fontFamily: FontFamily.sans,
    fontSize: FontSize.sm,
    lineHeight: FontSize.sm * LineHeight.normal,
  },
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    lineHeight: FontSize.sm * LineHeight.normal,
    letterSpacing: 0.3,
  },
  monoSmall: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    lineHeight: FontSize.xs * LineHeight.normal,
    letterSpacing: 0.25,
  },
  label: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    lineHeight: FontSize.xs * LineHeight.normal,
    letterSpacing: LetterSpacing.label,
    textTransform: 'uppercase' as const,
  },
  wordmark: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize.xl,
    letterSpacing: LetterSpacing.wider,
  },
};

export function Text({ variant = 'body', color = 'primary', style, ...props }: Props) {
  const c = useThemeColors();
  const colorMap = useMemo(
    () => ({
      primary: c.text,
      secondary: c.textSecondary,
      muted: c.muted,
      faint: c.faint,
      accent: c.text,
      danger: c.danger,
      inverse: c.inverseText,
    }),
    [c],
  );

  return (
    <RNText style={[variantStyles[variant], { color: colorMap[color] }, style]} {...props} />
  );
}

export const styles = StyleSheet.create({});
