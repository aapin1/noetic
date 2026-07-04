import { Platform } from 'react-native';

/** Times-adjacent serif for headlines; system defaults elsewhere. */
export const FontFamily = {
  serif: Platform.select({
    ios: 'Times New Roman',
    android: 'serif',
    default: 'Georgia',
  }) as string,
  serifItalic: Platform.select({
    ios: 'Times New Roman',
    android: 'serif',
    default: 'Georgia',
  }) as string,
  sans: Platform.select({
    ios: 'Helvetica Neue',
    android: 'sans-serif',
    default: 'sans-serif',
  }) as string,
  sansMedium: Platform.select({
    ios: 'Helvetica Neue',
    android: 'sans-serif',
    default: 'sans-serif',
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }) as string,
} as const;

export type AppThemeColors = {
  background: string;
  surface: string;
  elevated: string;
  text: string;
  textSecondary: string;
  muted: string;
  faint: string;
  border: string;
  borderSubtle: string;
  inverse: string;
  inverseText: string;
  danger: string;
  graphNode: string;
  graphLine: string;
  tabBar: string;
  tabBarBorder: string;
  mapBackground: string;
  mapBackgroundOverlay: string;
};

export const lightColors: AppThemeColors = {
  background: '#F5F4F0',
  surface: '#FFFFFF',
  elevated: '#EBEAE6',
  text: '#0A0A0A',
  textSecondary: '#2A2A2A',
  muted: '#5C5C5C',
  faint: '#8A8A8A',
  border: 'rgba(10,10,10,0.12)',
  borderSubtle: 'rgba(10,10,10,0.06)',
  inverse: '#0A0A0A',
  inverseText: '#F8F8F6',
  danger: '#6B1515',
  graphNode: 'rgba(10,10,10,0.85)',
  graphLine: 'rgba(10,10,10,0.15)',
  tabBar: '#F5F4F0',
  tabBarBorder: 'rgba(10,10,10,0.10)',
  mapBackground: '#1E1E1E',
  mapBackgroundOverlay: 'rgba(30,30,30,0.88)',
};

export const darkColors: AppThemeColors = {
  background: '#060606',
  surface: '#0E0E0E',
  elevated: '#141414',
  text: '#ECECEC',
  textSecondary: '#C8C8C8',
  muted: '#8E8E8E',
  faint: '#5A5A5A',
  border: 'rgba(255,255,255,0.12)',
  borderSubtle: 'rgba(255,255,255,0.06)',
  inverse: '#F0F0F0',
  inverseText: '#0A0A0A',
  danger: '#C47A7A',
  graphNode: 'rgba(236,236,236,0.9)',
  graphLine: 'rgba(255,255,255,0.12)',
  tabBar: '#060606',
  tabBarBorder: 'rgba(255,255,255,0.10)',
  mapBackground: '#060606',
  mapBackgroundOverlay: 'rgba(6,6,6,0.88)',
};

export const FontSize = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 26,
  '3xl': 32,
  '4xl': 40,
  '5xl': 52,
  display: 56,
} as const;

export const LineHeight = {
  tight: 1.12,
  snug: 1.22,
  normal: 1.4,
  relaxed: 1.55,
} as const;

export const LetterSpacing = {
  tight: -0.5,
  normal: 0,
  wide: 0.8,
  wider: 1.4,
  label: 2,
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
  14: 56,
  16: 64,
  20: 80,
} as const;

export const Radius = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  full: 9999,
} as const;

export const ONBOARDING_TOPICS = [
  'philosophy',
  'psychology',
  'economics',
  'history',
  'science',
  'literature',
  'law',
  'technology',
  'design',
  'film',
  'mathematics',
  'politics',
  'theology',
  'education',
  'art',
  'AI',
  'writing',
  'culture',
  'medicine',
  'architecture',
] as const;

export type OnboardingTopic = (typeof ONBOARDING_TOPICS)[number];
