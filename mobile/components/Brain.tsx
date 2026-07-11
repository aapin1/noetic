import React, { useState } from 'react';
import {
  StyleSheet,
  Text as RNText,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

interface Props {
  size?: number;
  density?: number;
  intensity?: number;
  showLines?: boolean;
  /** Overrides the theme text color — e.g. to stay light on the always-dark map. */
  color?: string;
}

const BRAIN_ART = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠀⢀⣀⣀⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⢀⣤⣶⣿⣿⣿⣆⠘⠿⠟⢻⣿⣿⡇⢐⣷⣦⣄⡀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⢸⣿⣿⣿⣧⡄⠙⣿⣷⣶⣶⡿⠿⠿⢃⣼⡟⠻⣿⣿⣶⡄⠀⠀⠀⠀',
  '⠀⠀⢰⣷⣌⠙⠉⣿⣿⡟⢀⣿⣿⡟⢁⣤⣤⣶⣾⣿⡇⠸⢿⣿⠿⢃⣴⡄⠀⠀',
  '⠀⠀⢸⣿⣿⣿⣿⠿⠋⣠⣾⣿⣿⠀⣾⣿⣿⣛⠛⢿⣿⣶⣤⣤⣴⣿⣿⣿⡆⠀',
  '⠀⣴⣤⣄⣀⣠⣤⣴⣾⣿⣿⣿⣿⣆⠘⠿⣿⣿⣷⡄⢹⣿⣿⠿⠟⢿⣿⣿⣿⠀',
  '⠀⢸⣿⣿⡿⠛⠛⣻⣿⣿⣿⣿⣿⣿⣷⣦⣼⣿⣿⠃⣸⣿⠃⢰⣶⣾⣿⣿⡟⠀',
  '⠀⠀⢿⡏⢠⣾⣿⣿⡿⠋⣠⣄⡉⢻⣿⣿⡿⠟⠁⠀⠛⠛⠀⠘⠿⠿⠿⠋⠀⠀',
  '⠀⠀⠁⠘⢿⣿⣿⣷⣤⣿⣿⠗⠀⣉⣥⣴⣶⡶⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⣤⣀⡉⠛⠛⠋⣉⣠⣴⠿⢿⣿⠿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠈⠻⢿⣿⣿⣿⣿⡿⠋⣠⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣤⡾⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⡿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀',
].join('\n');

// Font metrics for braille glyphs vary by platform, so rather than guess a
// character-width ratio we render the art once at a base size, measure the
// widest line, and scale the real render to fill `size` exactly. This keeps
// every row on a single line (no wrapping, which is what breaks the alignment)
// regardless of the font actually used.
const MEASURE_FONT = 10;

export function Brain({ size = 220, color }: Props) {
  const c = useThemeColors();
  const [fontSize, setFontSize] = useState<number | null>(null);

  const onMeasure = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (fontSize !== null) return;
    const widest = Math.max(...e.nativeEvent.lines.map((l) => l.width));
    if (widest > 0) {
      // Shave a hair off so rounding never pushes the widest line into a wrap.
      setFontSize((MEASURE_FONT * size) / widest * 0.98);
    }
  };

  return (
    <View style={[styles.wrap, { width: size }]} pointerEvents="none">
      {fontSize === null ? (
        <RNText
          style={[styles.measure, { fontFamily: FontFamily.mono, fontSize: MEASURE_FONT }]}
          onTextLayout={onMeasure}
        >
          {BRAIN_ART}
        </RNText>
      ) : (
        <RNText
          style={{
            fontFamily: FontFamily.mono,
            fontSize,
            // Braille rows read as one continuous image only when the lines sit
            // tight against each other, so pin line height to the glyph size.
            lineHeight: fontSize,
            color: color ?? c.text,
            opacity: 0.45,
            textAlign: 'left',
          }}
        >
          {BRAIN_ART}
        </RNText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Off-screen, unconstrained width so the measuring pass never wraps.
  measure: {
    position: 'absolute',
    opacity: 0,
    width: 100000,
  },
});
