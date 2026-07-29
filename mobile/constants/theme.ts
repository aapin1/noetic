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

/**
 * ── The palette ───────────────────────────────────────────────────
 *
 * Both themes are built on ONE warm neutral axis — roughly hue 38°, the colour
 * of unbleached paper — rather than on grey. Nothing here is a pure value: no
 * #FFFFFF, no #000000, no neutral #8A8A8A, and no black- or white-alpha
 * borders.
 *
 * That matters more than it sounds. A neutral ramp gives a screen exactly one
 * dimension to work in — lightness — so a list of text at four different
 * emphases reads as four shades of the same nothing, which is why the archive
 * and pulse screens looked like black type on a white sheet and nothing more.
 * On a warm axis the ramp carries hue as well: the light mode reads as paper
 * rather than as glare, the dark mode as ink rather than as void, and a tinted
 * border or fill sits in the same family as the type instead of cutting a grey
 * line through it.
 *
 * Two rules hold across both themes:
 *
 *   1. Chroma rises as contrast falls. The quietest tokens (`faint`, `border`)
 *      are the WARMEST, not just the palest — so de-emphasis reads as receding
 *      into the paper rather than as being washed out.
 *   2. Contrast is never traded away for warmth. Every token below meets or
 *      beats the ratio the neutral value it replaced achieved against its own
 *      background; `faint` and `muted` in particular came out ahead.
 */
export type AppThemeColors = {
  background: string;
  /** Page background for the list-heavy tabs (archive, pulse, you). In light
   * mode this is a clearly-deeper tone so those screens don't read as a single
   * white sheet; in dark mode it equals `background`. */
  canvas: string;
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
  /** Fill behind the focused tab's icon — see the tab bar in (tabs)/_layout. */
  tabBarActive: string;
  mapBackground: string;
  mapBackgroundOverlay: string;
};

export const lightColors: AppThemeColors = {
  // Paper, not page. Sits ~6% below white so a full screen of it doesn't
  // glare, which is the whole complaint with a #FFFFFF-backed light mode.
  background: '#F3EFE6',
  // A full step deeper than `background`, not a hair. This is the ground the
  // list tabs stand on, and it has to be a tone in its own right for the cards
  // sitting on it to read as raised at all.
  canvas: '#E8E3D6',
  // Card stock: the lightest thing in the app, and still not white.
  surface: '#FBF8F1',
  // A tinted BLOCK, not a lift — chips, meter tracks, message bubbles. Reads
  // as recessed against `background`, which is what every caller wants it for.
  elevated: '#EDE8DB',
  // Warm near-black. Pure black on warm paper is the one combination that
  // actually looks cheap: the type goes cold and detaches from the sheet.
  text: '#241F18',
  textSecondary: '#453D31',
  muted: '#6B6153',
  // Deliberately darker than the #8A8A8A it replaces (3.0:1 vs 2.8:1 on
  // canvas). Meta text was already the weakest link; warming it is not a
  // licence to weaken it further.
  faint: '#8A8071',
  // Brown-black alpha rather than neutral. A grey hairline over warm paper
  // reads as a seam; this reads as the edge of the sheet.
  border: 'rgba(58,46,30,0.14)',
  borderSubtle: 'rgba(58,46,30,0.07)',
  inverse: '#241F18',
  inverseText: '#F7F3EA',
  // Brick, not oxblood. The old #6B1515 was so dark and so cold it read as
  // black at small sizes — a danger colour nobody could see was dangerous.
  danger: '#8A3A2A',
  graphNode: 'rgba(36,31,24,0.85)',
  graphLine: 'rgba(36,31,24,0.16)',
  // A shade off `background`, so the bar is a surface the content scrolls
  // under rather than more page with a line drawn across it.
  tabBar: '#EFEADF',
  tabBarBorder: 'rgba(58,46,30,0.10)',
  tabBarActive: 'rgba(58,46,30,0.08)',
  // The map is dark in BOTH themes; warmed to match the ink below so light
  // mode's Atlas doesn't sit in a cold grey box.
  mapBackground: '#1A1712',
  mapBackgroundOverlay: 'rgba(26,23,18,0.88)',
};

export const darkColors: AppThemeColors = {
  // Ink with a warm bias. Kept nearly as deep as the old #060606 — the Atlas
  // needs a near-black to draw on — but no longer neutral.
  background: '#0C0B08',
  canvas: '#0C0B08',
  surface: '#16140F',
  elevated: '#1F1C15',
  // Warm off-white. The counterpart to light mode's warm near-black, and the
  // reason dark mode stops reading as a monitor test pattern.
  text: '#EFEADE',
  textSecondary: '#CBC3B3',
  muted: '#948B7B',
  // Also lifted against its predecessor (3.2:1 vs 2.6:1 for #5A5A5A).
  faint: '#68604F',
  border: 'rgba(239,234,222,0.13)',
  borderSubtle: 'rgba(239,234,222,0.06)',
  inverse: '#EFEADE',
  inverseText: '#0C0B08',
  danger: '#D08A76',
  graphNode: 'rgba(239,234,222,0.9)',
  graphLine: 'rgba(239,234,222,0.13)',
  tabBar: '#100E0A',
  tabBarBorder: 'rgba(239,234,222,0.09)',
  tabBarActive: 'rgba(239,234,222,0.09)',
  mapBackground: '#0A0907',
  mapBackgroundOverlay: 'rgba(10,9,7,0.88)',
};

/**
 * Mid-tone accents. Every one stays legible on both paper (#F3EFE6) and ink
 * (#0C0B08), so a single palette serves both themes — which is also the
 * constraint that pins their lightness: anything brighter fails on paper,
 * anything deeper fails on ink.
 *
 * So they were re-cut for CHROMA at the same lightness rather than made
 * brighter. The old set was desaturated enough that a small mark in amber and
 * a small mark in ochre were the same dirty tan; these are separable at the
 * size they actually get used — a 6px dot beside a row of type.
 */
export const Accents = {
  amber: '#B8863F',
  moss: '#63855A',
  clay: '#96524F',
  slate: '#4E6E88',
  ochre: '#C2854A',
  plum: '#7A6797',
} as const;

export const AccentList: readonly string[] = [
  Accents.amber,
  Accents.moss,
  Accents.clay,
  Accents.slate,
  Accents.ochre,
  Accents.plum,
];

/** Picks a stable accent from any number, so a card keeps its colour. */
export function accentFor(seed: number): string {
  return AccentList[Math.abs(Math.trunc(seed)) % AccentList.length];
}

/**
 * Stable accent for any string id — a topic keeps the same colour everywhere it
 * appears, and keeps it across sessions and devices.
 *
 * Hashed, never indexed by position in a list: a rank-indexed palette reshuffles
 * every item's colour the moment the list re-sorts, which is worse than no
 * colour at all. (Same reasoning as `clusterColorFor` on the Atlas, which is why
 * it uses the same hash.)
 */
export function accentForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return accentFor(Math.abs(h) || 1);
}

/** Time-of-day bands, used to colour the clock face. */
export function hourAccent(hour: number): string {
  if (hour < 6) return Accents.plum;
  if (hour < 12) return Accents.moss;
  if (hour < 18) return Accents.amber;
  return Accents.slate;
}

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
