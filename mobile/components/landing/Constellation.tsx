import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { FontFamily } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

/**
 * Nine points, as fractions of the field, laid out across the upper third so
 * they clear the middle band the text sits in. The first three are the muses who
 * survive: the intro draws THOSE dots itself, inside the names row, and flies
 * them up here to start — which is why only their coordinates are exported.
 *
 * Fixed rather than random, like the haze: the constellation has to be the same
 * shape every launch, and a random scatter will eventually produce a bad one.
 */
const POINTS = [
  // Upper field. The first three are the survivors, and they sit high so their
  // fall to the names row is a real distance.
  { x: 0.2, y: 0.13 }, // melete
  { x: 0.5, y: 0.06 }, // aoide
  { x: 0.8, y: 0.14 }, // mneme
  { x: 0.09, y: 0.24 },
  { x: 0.34, y: 0.235 },
  { x: 0.63, y: 0.245 },
  { x: 0.91, y: 0.075 },
  { x: 0.44, y: 0.3 },
  { x: 0.72, y: 0.29 },
  // Lower field, so the bottom half is not bare. Kept clear of the middle band
  // where the text sits, and unjoined to the upper group — an edge between them
  // would have to cross the words.
  { x: 0.15, y: 0.8 },
  { x: 0.33, y: 0.87 },
  { x: 0.55, y: 0.79 },
  { x: 0.74, y: 0.9 },
  { x: 0.88, y: 0.78 },
];

export const SURVIVORS = POINTS.slice(0, 3);
const EXTRAS = POINTS.slice(3);

/**
 * Indices into POINTS. Every edge joins near neighbours — long ones cut across
 * the field and turn the whole thing into a scribbled polygon rather than a
 * constellation. Enough to read as joined, not as a mesh.
 */
const EDGES: [number, number][] = [
  [3, 0],
  [0, 4],
  [3, 4],
  [4, 7],
  [0, 1],
  [1, 5],
  [5, 2],
  [2, 6],
  [5, 8],
  [7, 5],
  [9, 10],
  [10, 11],
  [11, 12],
  [12, 13],
  [11, 13],
];

const DOT = '⠐';
const DOT_SIZE = 20;
/** Shared with the intro's three, so a survivor never looks heavier than the rest. */
const DOT_ALPHA = 0.5;

interface Props {
  width: number;
  height: number;
  /** The six who do not survive. */
  pointOpacity: Animated.AnimatedInterpolation<number>;
  /** Faded a beat earlier than the points, so the web lets go before they do. */
  edgeOpacity: Animated.AnimatedInterpolation<number>;
}

export function Constellation({ width, height, pointOpacity, edgeOpacity }: Props) {
  const c = useThemeColors();

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: edgeOpacity }]} pointerEvents="none">
        <Svg width={width} height={height}>
          {EDGES.map(([a, b], i) => (
            <Line
              key={i}
              x1={POINTS[a].x * width}
              y1={POINTS[a].y * height}
              x2={POINTS[b].x * width}
              y2={POINTS[b].y * height}
              stroke={c.text}
              strokeOpacity={0.09}
              strokeWidth={0.6}
            />
          ))}
        </Svg>
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: pointOpacity }]} pointerEvents="none">
        {EXTRAS.map((p, i) => (
          <Text
            key={i}
            style={{
              position: 'absolute',
              // The glyph is drawn from its box's top-left, so pull it back by
              // half to sit the mark itself on the point the edges meet at.
              left: p.x * width - DOT_SIZE / 2,
              top: p.y * height - DOT_SIZE / 2,
              fontFamily: FontFamily.mono,
              fontSize: DOT_SIZE,
              lineHeight: DOT_SIZE,
              color: c.text,
              opacity: DOT_ALPHA,
            }}
          >
            {DOT}
          </Text>
        ))}
      </Animated.View>
    </>
  );
}

export { DOT, DOT_SIZE, DOT_ALPHA };
