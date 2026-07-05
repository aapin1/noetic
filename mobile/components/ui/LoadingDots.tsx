import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useThemeColors } from '@/contexts/ThemeContext';

interface Props {
  /** Dot diameter in px. */
  size?: number;
  /** Overrides the default muted dot color. */
  color?: string;
}

/**
 * Three dots that fade in sequence. The app's standard "working on it" signal,
 * used anywhere a screen or action is loading so feedback looks the same
 * everywhere.
 */
export function LoadingDots({ size = 6, color }: Props) {
  const c = useThemeColors();
  const dotColor = color ?? c.muted;
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    const loops = anims.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 420, useNativeDriver: true }),
          Animated.delay((2 - i) * 180),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);

  return (
    <View style={styles.row} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {anims.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: dotColor,
            opacity: v,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
