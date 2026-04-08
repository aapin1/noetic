import { Platform } from 'react-native';

export const Colors = {
  background: '#F6F2E9',
  surface: '#FBF8F2',
  elevatedSurface: '#F2EBDD',
  cardBorder: 'rgba(36,44,38,0.08)',
  primaryText: '#1E241F',
  secondaryText: '#5E665F',
  mutedText: '#8A9088',
  accentGold: '#C8A55B',
  accentGoldLight: 'rgba(200,165,91,0.12)',
  accentViolet: '#8C7BFF',
  accentVioletLight: 'rgba(140,123,255,0.12)',
  success: '#78D39D',
  danger: '#E86C6C',
  softHighlight: 'rgba(200,165,91,0.12)',
  white: '#FFFFFF',
  overlay: 'rgba(30,36,31,0.48)',
  inputBackground: 'rgba(30,36,31,0.04)',
  inputBorder: 'rgba(30,36,31,0.12)',
  inputFocusBorder: '#C8A55B',
  tabBarBackground: '#FBF8F2',
  tabBarBorder: 'rgba(36,44,38,0.08)',
  skeletonBase: 'rgba(30,36,31,0.06)',
  skeletonHighlight: 'rgba(30,36,31,0.12)',
} as const;

export const FontFamily = {
  heading: 'Fraunces_700Bold',
  headingRegular: 'Fraunces_400Regular',
  headingLight: 'Fraunces_300Light',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 26,
  '3xl': 32,
  '4xl': 40,
  '5xl': 52,
} as const;

export const LineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,
} as const;

export const Spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  hero: 32,
  full: 9999,
} as const;

export const Shadow = {
  soft: Platform.select({
    ios: {
      shadowColor: '#1E241F',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
    },
    android: { elevation: 3 },
  }),
  medium: Platform.select({
    ios: {
      shadowColor: '#1E241F',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
    },
    android: { elevation: 5 },
  }),
  strong: Platform.select({
    ios: {
      shadowColor: '#1E241F',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 28,
    },
    android: { elevation: 8 },
  }),
} as const;

export const ONBOARDING_TOPICS = [
  'philosophy',
  'psychology',
  'economics',
  'politics',
  'history',
  'literature',
  'film',
  'music',
  'art',
  'design',
  'technology',
  'computer science',
  'AI',
  'startups',
  'science',
  'mathematics',
  'theology',
  'law',
  'education',
  'journalism',
  'culture',
  'writing',
  'health',
  'philosophy of mind',
] as const;

export type Topic = (typeof ONBOARDING_TOPICS)[number];
