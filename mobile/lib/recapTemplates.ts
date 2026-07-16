import { AccentList } from '@/constants/theme';

/**
 * Share-card templates. Each one is a self-contained look (fixed palette + a few
 * treatment flags) so a card renders the same regardless of the viewer's app
 * theme — the user picks the vibe, not their device. The composer resolves a
 * palette per frame (cover uses index 0, node i uses index i) so a colour
 * template still rotates accents across a slideshow.
 */

export type RecapTemplateId = 'paper' | 'ink' | 'mono' | 'bloom';

export type CoverTreatment = 'bar' | 'accent' | 'ascii';

export interface TemplatePalette {
  id: RecapTemplateId;
  /** Matte behind the card — the full-bleed image background. */
  bg: string;
  surface: string;
  /** Secondary block fill (e.g. the tinted panel behind a node's idea). */
  accentSoft: string;
  text: string;
  textSecondary: string;
  faint: string;
  border: string;
  accent: string;
  /** Thickness of the top rule on the cover/poster. */
  barHeight: number;
  cover: CoverTreatment;
  /** Colour the big serif titles get (accent for Bloom, ink text otherwise). */
  titleColor: string;
  ascii: boolean;
}

export interface RecapTemplateMeta {
  id: RecapTemplateId;
  name: string;
  blurb: string;
  /** Colours drawn in the picker swatch, left→right. */
  swatch: string[];
}

export const RECAP_TEMPLATES: RecapTemplateMeta[] = [
  { id: 'paper', name: 'Paper', blurb: 'warm, editorial', swatch: ['#F5F4F0', '#B8894B', '#5B6E7F'] },
  { id: 'ink', name: 'Ink', blurb: 'dark, quiet', swatch: ['#0E0E0E', '#6B7F5B', '#C08A5A'] },
  { id: 'mono', name: 'Mono', blurb: 'minimal, ascii', swatch: ['#FFFFFF', '#121212', '#9A9A9A'] },
  { id: 'bloom', name: 'Bloom', blurb: 'bold colour', swatch: ['#8A5A5A', '#6B7F5B', '#7A6E8A'] },
];

function accentAt(index: number): string {
  return AccentList[Math.abs(Math.trunc(index)) % AccentList.length];
}

export function resolveTemplate(id: RecapTemplateId, index: number): TemplatePalette {
  const accent = accentAt(index);
  switch (id) {
    case 'ink':
      return {
        id,
        bg: '#060606',
        surface: '#101010',
        accentSoft: '#1A1A1A',
        text: '#ECECEC',
        textSecondary: '#C8C8C8',
        faint: '#6E6E6E',
        border: 'rgba(255,255,255,0.14)',
        accent,
        barHeight: 6,
        cover: 'bar',
        titleColor: '#ECECEC',
        ascii: false,
      };
    case 'mono':
      return {
        id,
        bg: '#FFFFFF',
        surface: '#FFFFFF',
        accentSoft: '#F2F2F2',
        text: '#121212',
        textSecondary: '#3C3C3C',
        faint: '#9A9A9A',
        border: 'rgba(0,0,0,0.16)',
        accent: '#121212',
        barHeight: 0,
        cover: 'ascii',
        titleColor: '#121212',
        ascii: true,
      };
    case 'bloom':
      return {
        id,
        bg: '#F3EEE6',
        surface: '#FBF8F2',
        // 8%-alpha accent tint for the panel behind a node's idea.
        accentSoft: `${accent}16`,
        text: '#141210',
        textSecondary: '#463F38',
        faint: '#9A8F82',
        border: 'rgba(20,18,16,0.12)',
        accent,
        barHeight: 14,
        cover: 'accent',
        titleColor: accent,
        ascii: false,
      };
    case 'paper':
    default:
      return {
        id,
        bg: '#F5F4F0',
        surface: '#FFFFFF',
        accentSoft: '#EEEDE9',
        text: '#0A0A0A',
        textSecondary: '#2A2A2A',
        faint: '#8A8A8A',
        border: 'rgba(10,10,10,0.12)',
        accent,
        barHeight: 6,
        cover: 'bar',
        titleColor: '#0A0A0A',
        ascii: false,
      };
  }
}
