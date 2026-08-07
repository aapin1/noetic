import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { FontFamily } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

const FADE_MS = 900;

interface Mark {
  /** Position as a percentage of the field, so the layout holds on any screen. */
  x: number;
  y: number;
  size: number;
  glyph: string;
}

interface Layer {
  alpha: number;
  amplitude: number;
  period: number;
  marks: Mark[];
}

/**
 * Three parallax layers of drifting braille dots — the same alphabet the Brain
 * is drawn in, so the haze reads as house style rather than as a particle
 * effect. Positions are a fixed table rather than random: the field renders
 * identically every launch and can never accidentally clump.
 *
 * Each LAYER animates as one unit — two shared values apiece, six in total,
 * rather than one per mark. Depth comes from the parallax: the nearest layer
 * has the largest, most opaque glyphs and drifts furthest. The two periods
 * within a layer are deliberately unequal so the marks trace a slow Lissajous
 * path instead of a straight diagonal, and the three layers never resync.
 */
const LAYERS: Layer[] = [
  {
    alpha: 0.16,
    amplitude: 22,
    period: 17000,
    marks: [
      { x: 12, y: 18, size: 18, glyph: '⠂' },
      { x: 78, y: 12, size: 20, glyph: '⠄' },
      { x: 34, y: 72, size: 16, glyph: '⠁' },
      { x: 88, y: 58, size: 17, glyph: '⠈' },
      { x: 56, y: 88, size: 19, glyph: '⠐' },
    ],
  },
  {
    alpha: 0.1,
    amplitude: 16,
    period: 23000,
    marks: [
      { x: 24, y: 40, size: 13, glyph: '⠄' },
      { x: 66, y: 30, size: 12, glyph: '⠁' },
      { x: 8, y: 62, size: 14, glyph: '⠐' },
      { x: 46, y: 8, size: 12, glyph: '⠂' },
      { x: 92, y: 80, size: 13, glyph: '⠈' },
    ],
  },
  {
    alpha: 0.06,
    amplitude: 10,
    period: 29000,
    marks: [
      { x: 40, y: 26, size: 9, glyph: '⠁' },
      { x: 18, y: 84, size: 10, glyph: '⠂' },
      { x: 72, y: 66, size: 8, glyph: '⠄' },
      { x: 60, y: 52, size: 9, glyph: '⠈' },
      { x: 30, y: 4, size: 10, glyph: '⠐' },
    ],
  },
];

function breathe(value: SharedValue<number>, period: number) {
  value.value = withRepeat(
    withSequence(
      withTiming(1, { duration: period / 2, easing: Easing.inOut(Easing.sin) }),
      withTiming(0, { duration: period / 2, easing: Easing.inOut(Easing.sin) }),
    ),
    -1,
    false,
  );
}

function HazeLayer({
  layer,
  fade,
  animate,
  color,
}: {
  layer: Layer;
  fade: SharedValue<number>;
  animate: boolean;
  color: string;
}) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);

  useEffect(() => {
    if (!animate) return;
    breathe(dx, layer.period);
    // Off the X period by an irrational-ish ratio, so the pair never repeats.
    breathe(dy, layer.period * 1.37);
  }, [animate, dx, dy, layer.period]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: fade.value * layer.alpha * interpolate(dy.value, [0, 1], [0.8, 1.2]),
    transform: [
      { translateX: interpolate(dx.value, [0, 1], [-layer.amplitude, layer.amplitude]) },
      { translateY: interpolate(dy.value, [0, 1], [layer.amplitude * 0.7, -layer.amplitude * 0.7]) },
    ],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, animStyle]}>
      {layer.marks.map((m, i) => (
        <Text
          key={i}
          style={{
            position: 'absolute',
            left: `${m.x}%`,
            top: `${m.y}%`,
            fontFamily: FontFamily.mono,
            fontSize: m.size,
            lineHeight: m.size,
            color,
          }}
        >
          {m.glyph}
        </Text>
      ))}
    </Animated.View>
  );
}

interface Props {
  /** Target opacity for the whole field. Eased into, so this doubles as the fade-in. */
  opacity: number;
  reduceMotion: boolean;
}

export function HazeField({ opacity, reduceMotion }: Props) {
  const c = useThemeColors();
  const fade = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      fade.value = opacity;
      return;
    }
    fade.value = withTiming(opacity, { duration: FADE_MS, easing: Easing.out(Easing.quad) });
  }, [fade, opacity, reduceMotion]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {LAYERS.map((layer, i) => (
        <HazeLayer key={i} layer={layer} fade={fade} animate={!reduceMotion} color={c.text} />
      ))}
    </View>
  );
}
