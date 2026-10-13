import React, { useMemo } from 'react';
import { Text as RNText, TextProps, StyleSheet } from 'react-native';
import { FontFamily, FontSize, LetterSpacing, LineHeight } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

/**
 * The app's type scale, mapped onto Apple's text styles so a screen built from
 * these variants reads like any other iOS app:
 *
 *   hero / display   big serif numbers and marks (brand voice only)
 *   h1               large title, 34 bold
 *   h2               title 1, 28 bold
 *   h3               title 2, 22 bold
 *   h4               title 3, 20 semibold
 *   headline         17 semibold  (row titles, section headers)
 *   body             17 regular
 *   bodyMedium       17 medium
 *   bodySemiBold     17 semibold
 *   subheadline      15 regular   (secondary lines under a title)
 *   caption          13 regular   (footnote: dates, counts, hints)
 *   captionSmall     12 regular   (caption 1: axis ticks, tiny meta)
 *   label            13 regular   (same as caption; kept for old call sites)
 *   mono / monoSmall 13 / 12 in the system face. Historical names: these used
 *                    to be tracked Menlo. They are now ordinary footnote text
 *                    so that hundreds of call sites fall into line at once;
 *                    reach for `tabular` when you actually want aligned digits.
 *   tabular          13 with tabular figures, for counts and times in columns
 *   serif / serifLg  reading-size serif (quotes, bios, long insight prose)
 *   wordmark         the brand mark
 */
type Variant =
  | 'hero'
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'headline'
  | 'body'
  | 'bodyMedium'
  | 'bodySemiBold'
  | 'subheadline'
  | 'caption'
  | 'captionSmall'
  | 'mono'
  | 'monoSmall'
  | 'tabular'
  | 'label'
  | 'serif'
  | 'serifLg'
  | 'wordmark';

type Color = 'primary' | 'secondary' | 'muted' | 'faint' | 'accent' | 'danger' | 'inverse';

interface Props extends TextProps {
  variant?: Variant;
  color?: Color;
}

const sans = (size: number, weight: '400' | '500' | '600' | '700', lh: number = LineHeight.normal) => ({
  fontFamily: FontFamily.sans,
  fontSize: size,
  lineHeight: Math.round(size * lh),
  fontWeight: weight,
});

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
  h1: sans(FontSize['3xl'], '700', LineHeight.tight),
  h2: sans(FontSize['2xl'], '700', LineHeight.snug),
  h3: sans(FontSize.xl, '700', LineHeight.snug),
  h4: sans(FontSize.lg, '600', LineHeight.snug),
  headline: sans(FontSize.md, '600'),
  body: sans(FontSize.md, '400', LineHeight.relaxed),
  bodyMedium: sans(FontSize.md, '500'),
  bodySemiBold: sans(FontSize.md, '600'),
  subheadline: sans(FontSize.base, '400'),
  caption: sans(FontSize.sm, '400'),
  captionSmall: sans(12, '400'),
  label: sans(FontSize.sm, '400'),
  mono: sans(FontSize.sm, '400'),
  monoSmall: sans(12, '400'),
  tabular: { ...sans(FontSize.sm, '400'), fontVariant: ['tabular-nums'] as const },
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
