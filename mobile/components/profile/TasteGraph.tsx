import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { Colors, FontFamily } from '@/constants/theme';

interface Props {
  tasteVector: Record<string, number>;
  size?: number;
}

const PALETTE = [
  Colors.accentGold,
  Colors.accentViolet,
  Colors.success,
  '#E8A06C',
  '#6CB5E8',
  '#E86CA0',
];

function getTopEntries(vector: Record<string, number>, n: number) {
  return Object.entries(vector)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function TasteGraph({ tasteVector, size = 280 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = (size / 2) * 0.82;

  const nodes = useMemo(() => {
    const entries = getTopEntries(tasteVector, 8);
    if (entries.length === 0) return [];
    const maxVal = entries[0][1] || 1;
    return entries.map(([key, val], i) => {
      const angle = (i / entries.length) * 2 * Math.PI - Math.PI / 2;
      const weight = val / maxVal;
      const r = maxRadius * 0.4 + maxRadius * 0.45 * weight;
      const nodeRadius = 6 + weight * 14;
      const label = key.replace(/^topic:|^source:/, '');
      return {
        key,
        label,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        weight,
        nodeRadius,
        color: PALETTE[i % PALETTE.length],
      };
    });
  }, [tasteVector, cx, cy, maxRadius]);

  if (nodes.length === 0) {
    return (
      <View style={[styles.empty, { width: size, height: size }]}>
        <View style={styles.emptyCenter} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Svg width={size} height={size}>
        <Circle
          cx={cx}
          cy={cy}
          r={maxRadius * 0.38}
          fill="none"
          stroke={Colors.cardBorder}
          strokeWidth={1}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={maxRadius * 0.65}
          fill="none"
          stroke={Colors.cardBorder}
          strokeWidth={1}
          strokeDasharray="4 6"
        />

        {nodes.map((node, i) =>
          nodes.slice(i + 1).map((other) => {
            const overlap = Math.min(node.weight, other.weight);
            if (overlap < 0.3) return null;
            return (
              <Line
                key={`${node.key}-${other.key}`}
                x1={node.x}
                y1={node.y}
                x2={other.x}
                y2={other.y}
                stroke={node.color}
                strokeWidth={overlap * 1.5}
                strokeOpacity={0.25}
              />
            );
          }),
        )}

        {nodes.map((node) => (
          <React.Fragment key={node.key}>
            <Circle
              cx={node.x}
              cy={node.y}
              r={node.nodeRadius + 4}
              fill={node.color}
              fillOpacity={0.15}
            />
            <Circle
              cx={node.x}
              cy={node.y}
              r={node.nodeRadius}
              fill={node.color}
              fillOpacity={0.85}
            />
            <SvgText
              x={node.x}
              y={node.y + node.nodeRadius + 12}
              textAnchor="middle"
              fontSize={9}
              fontFamily={FontFamily.mono}
              fill={Colors.secondaryText}
            >
              {node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label}
            </SvgText>
          </React.Fragment>
        ))}

        <Circle
          cx={cx}
          cy={cy}
          r={10}
          fill={Colors.accentGold}
          fillOpacity={0.6}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={5}
          fill={Colors.accentGold}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCenter: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderStyle: 'dashed',
  },
});
