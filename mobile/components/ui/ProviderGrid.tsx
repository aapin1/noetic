import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

const TILE = 52;

export type ProviderMark = {
  /** Unique per tile — a provider key or `session:<target>`. */
  id: string;
  /** Which drawn mark to use (provider or session-target key). */
  mark: string;
  name: string;
  /** Brand-ish accent for the mark — one colour, never an asset. */
  accent: string;
};

/**
 * The marks are drawn, not loaded: a typographic initial in each service's
 * colour, plus the two shapes people know on sight (Letterboxd's three dots,
 * YouTube's play tile). No logo files, nothing to license.
 */
export function Mark({ mark, color }: { mark: string; color: string }) {
  const c = useThemeColors();
  if (mark === 'letterboxd') {
    return (
      <View style={styles.dots}>
        {['#FF8000', '#00E054', '#40BCF4'].map((dot) => (
          <View key={dot} style={[styles.dot, { backgroundColor: dot }]} />
        ))}
      </View>
    );
  }
  if (mark === 'youtube' || mark === 'youtube-liked') {
    return (
      <View style={[styles.play, { backgroundColor: color }]}>
        <View style={[styles.tri, { borderLeftColor: c.surface }]} />
      </View>
    );
  }
  const glyph: Record<string, string> = {
    goodreads: 'g',
    readwise: 'R',
    anilist: 'A',
    trakt: 't',
    hardcover: 'H',
    raindrop: 'r',
    instapaper: 'I',
    bluesky: '🦋',
    mastodon: 'm',
    hackernews: 'Y',
    reddit: 'r/',
    tumblr: 't',
    medium: 'M',
    substack: 'S',
    bookwyrm: 'b',
    pinboard: 'p',
    arena: '✦',
    zotero: 'Z',
    github: '⌥',
    kitsu: 'k',
    steam: '⚙',
    backloggd: 'B',
    rawg: 'R',
    listenbrainz: '♫',
    bandcamp: 'bc',
    netflix: 'N',
    kindle: 'k',
    crunchyroll: 'cr',
  };
  const g = glyph[mark] ?? '?';
  const serif = mark === 'instapaper' || mark === 'goodreads' || mark === 'medium' || mark === 'zotero' || mark === 'netflix';
  return (
    <Text style={[styles.glyph, g.length > 1 && { fontSize: 18 }, { color, fontFamily: serif ? FontFamily.serif : FontFamily.sansMedium }]}>
      {g}
    </Text>
  );
}

export type ProviderSection = { title: string; marks: ProviderMark[] };

type Props = {
  sections: ProviderSection[];
  onPick: (id: string) => void;
};

/**
 * Every service on screen at once: a wrapped grid, five to a row, grouped by
 * what the content IS (films, books, saves…) under whisper-quiet labels.
 * Tap a mark and its connect sheet rises — no drifting strip, nothing to
 * chase.
 */
export function ProviderGrid({ sections, onPick }: Props) {
  const c = useThemeColors();
  return (
    <View style={styles.wrap}>
      {sections
        .filter((s) => s.marks.length > 0)
        .map((s) => (
          <View key={s.title}>
            <Text variant="label" color="faint" style={styles.section}>
              {s.title}
            </Text>
            <View style={styles.grid} accessibilityRole="list">
              {s.marks.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onPick(m.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Connect ${m.name}`}
                  style={styles.cell}
                  hitSlop={4}
                  testID={`pick-${m.id}`}
                >
                  <View style={[styles.tile, { borderColor: c.border, backgroundColor: c.surface }]}>
                    <Mark mark={m.mark} color={m.accent} />
                  </View>
                  <Text style={[styles.name, { color: c.faint }]} numberOfLines={1}>
                    {m.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing[4] },
  section: { marginBottom: Spacing[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  cell: { width: '20%', alignItems: 'center', marginBottom: Spacing[3] },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: Spacing[1], fontFamily: FontFamily.mono, fontSize: 9, letterSpacing: 0.3 },
  glyph: { fontSize: 24, lineHeight: 28 },
  dots: { flexDirection: 'row' },
  dot: { width: 15, height: 15, borderRadius: 8, marginHorizontal: -2.5 },
  play: { width: 30, height: 21, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tri: {
    width: 0,
    height: 0,
    marginLeft: 2,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
});
