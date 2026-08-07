import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { FontFamily } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

/**
 * Nine points, as fractions of the field, laid out across the upper third so
 * they never collide with the text beneath them. The first three are the muses
 * who survive: the intro draws THOSE dots itself, inside the names row, and
 * flies them here — which is why only their coordinates are exported.
 *
 * Fixed rather than random, like the haze: the constellation has to be the same
 * shape every launch, and a random nine will eventually produce a bad one.
 */
const POINTS = [
  { x: 0.3, y: 0.13 }, // melete
  { x: 0.5, y: 0.075 }, // aoide
  { x: 0.68, y: 0.15 }, // mneme
  { x: 0.19, y: 0.22 },
  { x: 0.38, y: 0.235 },
  { x: 0.6, y: 0.255 },
  { x: 0.81, y: 0.1 },
  { x: 0.47, y: 0.31 },
  { x: 0.72, y: 0.285 },
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
  [0, 1],
  [1, 2],
  [2, 6],
  [0, 4],
  [4, 7],
  [4, 5],
  [5, 8],
  [5, 2],
  [3, 4],
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
