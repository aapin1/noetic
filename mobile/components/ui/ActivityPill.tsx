import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { GLASS_BG, GLASS_BORDER } from '@/constants/mapPalette';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { Text } from '@/components/ui/Text';

type Props = {
  top: number;
  /** busy: something is reading/mapping right now. done: it just finished. */
  phase: 'busy' | 'done';
  /** "reading your letterboxd…" */
  line: string;
  /** Optional second line: "34 of 120 on your map". */
  sub?: string;
  onClose: () => void;
};

/**
 * Background work, narrated: the capture pill's glass-and-cat idiom from the
 * right edge, shown while a connection sync or file import is running so a
 * first sync never looks like the app doing nothing. Same corner, same
 * manners as the other pills — it only speaks when nothing else is.
 */
export function ActivityPill({ top, phase, line, sub, onClose }: Props) {
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 8, tension: 60 }).start();
  }, [slide]);

  return (
    <Animated.View
      style={[
        styles.pill,
        {
          top,
          backgroundColor: GLASS_BG,
          borderColor: GLASS_BORDER,
          opacity: slide,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [72, 0] }) }],
        },
      ]}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row} pointerEvents="auto">
        <AsciiLoader inline variant={phase === 'busy' ? 'mail' : 'cat'} idle={phase !== 'busy'} size={30} color="rgba(240,232,214,0.77)" />
        <Text style={[styles.mono, { color: 'rgba(240,232,214,0.69)', flex: 1 }]}>{line}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Text style={[styles.mono, { color: 'rgba(240,232,214,0.49)' }]}>✕</Text>
        </Pressable>
      </View>
      {sub ? (
        <Text style={[styles.mono, { color: 'rgba(240,232,214,0.45)' }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: Spacing[4],
    width: 226,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
    gap: Spacing[3],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  mono: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, letterSpacing: 1 },
});
