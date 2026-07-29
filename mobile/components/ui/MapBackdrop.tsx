import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Pattern, Rect, Stop } from 'react-native-svg';
import { useThemeColors } from '@/contexts/ThemeContext';

const { width: SW, height: SH } = Dimensions.get('window');

// The grid's ink: the same warm light the rest of the map chrome is drawn in
// (see constants/mapPalette), so the backdrop belongs to the surface its points
// sit on. Its real weight comes from the 0.04 and 0.012–0.03 opacities below —
// this stays under the notice threshold by design.
const BACKDROP_INK = 'rgba(240,232,214,0.92)';

/**
 * The Atlas backdrop: base tone + dot grid + vertical wash. This is THE
 * definition of what a map surface looks like — Atlas and every Mind surface
 * render it, so the two can never drift into looking like different apps.
 *
 * Screen-fixed and drawn once. It does not pan with the map: Atlas's world SVG
 * is transparent and sits above this, so the grid shows through everywhere,
 * including any sliver the transformed world hasn't covered mid-gesture (which
 * therefore reads as more map rather than a darker box around charted
 * territory). Keeping it out of the world layer is what stops every re-commit
 * from re-rasterizing a Pattern and a gradient across the overscanned area.
 */
export function MapBackdrop() {
  const c = useThemeColors();
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: c.mapBackground }]}
      pointerEvents="none"
    >
      <Svg width={SW} height={SH} style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="staticDotGrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
            <Circle cx="16" cy="16" r="0.9" fill={BACKDROP_INK} fillOpacity={0.04} />
          </Pattern>
          <LinearGradient id="staticBgTone" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={BACKDROP_INK} stopOpacity={0.012} />
            <Stop offset="100%" stopColor={BACKDROP_INK} stopOpacity={0.03} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={SW} height={SH} fill="url(#staticDotGrid)" />
        <Rect x="0" y="0" width={SW} height={SH} fill="url(#staticBgTone)" />
      </Svg>
    </View>
  );
}
