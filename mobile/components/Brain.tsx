import React from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { FontFamily } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

interface Props {
  size?: number;
  density?: number;
  intensity?: number;
  showLines?: boolean;
}

const BRAIN_ART = [
  '   .---.  .---.',
  '  (  .  )(  .  )',
  "   '---'  '---'",
  "     '------'",
  '         |',
].join('\n');

export function Brain({ size = 220 }: Props) {
  const c = useThemeColors();
  const fontSize = Math.round(size / 11);

  return (
    <View style={[styles.wrap, { width: size }]} pointerEvents="none">
      <RNText
        style={{
          fontFamily: FontFamily.mono,
          fontSize,
          lineHeight: Math.round(fontSize * 1.6),
          color: c.text,
          opacity: 0.45,
          letterSpacing: 0,
          textAlign: 'center',
        }}
      >
        {BRAIN_ART}
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
