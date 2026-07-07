import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * A one-shot confetti burst driven entirely on the UI thread. Each piece gets a
 * little upward launch velocity and then falls under "gravity" (the p² term),
 * spinning and fading as it goes — enough physics to read as real confetti
 * rather than a shower of falling dots. Colours are muted editorial tones so the
 * burst still feels like mneme on both the light and dark backgrounds.
 */

// Mid-tone, low-saturation accents that stay legible on paper (#F5F4F0) and ink (#060606).
const COLORS = ['#B8894B', '#6B7F5B', '#8A5A5A', '#5B6E7F', '#C08A5A', '#7A6E8A'];

interface Piece {
  vx: number;
  vy: number;
  g: number;
  spin: number;
  size: number;
  ratio: number; // height multiplier — most pieces are little rectangles
  color: string;
  startFrac: number;
  radius: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface Props {
  /** Changing this value re-fires the burst. */
  trigger: number | boolean;
  count?: number;
  duration?: number;
  /** How far down the container the burst originates (0–1). */
  originY?: number;
  onDone?: () => void;
}

export function Confetti({ trigger, count = 26, duration = 2200, originY = 0.32, onDone }: Props) {
  const progress = useSharedValue(0);

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: count }, () => ({
        vx: rand(-220, 220),
        vy: rand(-560, -340),
        g: rand(720, 1040),
        spin: rand(-6, 6),
        size: rand(6, 11),
        ratio: Math.random() < 0.75 ? rand(1.6, 2.6) : 1,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        startFrac: rand(0, 0.12),
        radius: Math.random() < 0.25 ? 999 : 1.5,
      })),
    [count],
  );

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration, easing: Easing.linear }, (finished) => {
      if (finished && onDone) {
        runOnJS(onDone)();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: `${originY * 100}%` }]}>
      {pieces.map((piece, i) => (
        <ConfettiPiece key={i} piece={piece} progress={progress} />
      ))}
    </Animated.View>
  );
}

function ConfettiPiece({
  piece,
  progress,
}: {
  piece: Piece;
  progress: Animated.SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const raw = (progress.value - piece.startFrac) / (1 - piece.startFrac);
    const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const x = piece.vx * p;
    const y = piece.vy * p + piece.g * p * p;
    const pop = p < 0.12 ? p / 0.12 : 1;
    const opacity = p < 0.82 ? 1 : 1 - (p - 0.82) / 0.18;

    return {
      opacity: opacity < 0 ? 0 : opacity,
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${piece.spin * p * 360}deg` },
        { scale: pop },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          width: piece.size,
          height: piece.size * piece.ratio,
          backgroundColor: piece.color,
          borderRadius: piece.radius,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    left: '50%',
    marginLeft: -5,
  },
});
