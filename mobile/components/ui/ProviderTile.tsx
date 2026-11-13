import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FontFamily, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

/**
 * A service's mark: its initial in the system face on a tile of its colour.
 * One rule for every service, so a column of them lines up. No logo files,
 * nothing to license. The hairline keeps near-black brands visible on the
 * dark theme.
 */
export function ProviderTile({ name, accent, size = 36 }: { name: string; accent: string; size?: number }) {
  const c = useThemeColors();
  return (
    <View
      style={[styles.tile, { width: size, height: size, backgroundColor: accent, borderColor: c.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.initial, { fontSize: size * 0.47, lineHeight: size * 0.58 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#FFFFFF', fontFamily: FontFamily.sans, fontWeight: '600' },
});
