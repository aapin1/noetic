import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { Radius } from '@/constants/theme';
import type { PulseMapCluster, PulseMapNode } from '@/types/api';

// Same cluster palette the full atlas uses, so a friend's regions read in the
// same colors here as they would on their own map.
const CLUSTER_PALETTE = [
  '#6B9FD4',
  '#9B84CC',
  '#7EC8A0',
  '#E8A87C',
  '#E87878',
  '#78C8C8',
  '#C4A882',
  '#A0B8D4',
  '#CC84A0',
  '#A8CC84',
];

// The map is always dark, matching the atlas tab regardless of app theme.
const MAP_BG = '#060606';
const MAP_NODE = 'rgba(236,236,236,0.85)';
const MAJOR_CLUSTER_MIN = 2;

interface Props {
  nodes: PulseMapNode[];
  clusters: PulseMapCluster[];
  width: number;
  height?: number;
}

/**
 * A miniature, non-interactive rendering of someone's semantic map: their
 * captures placed at their real embedding coordinates, dots colored by the
 * major region each one anchors to. A glance-able version of the atlas.
 */
export function MiniMap({ nodes, clusters, width, height = 148 }: Props) {
  const colorByTopic = useMemo(() => {
    const map = new Map<string, string>();
    clusters
      .filter((cl) => cl.count >= MAJOR_CLUSTER_MIN)
      .sort((a, b) => b.count - a.count)
      .forEach((cl, i) => map.set(cl.topicId, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]));
    return map;
  }, [clusters]);

  const pad = 12;
  const colorFor = (node: PulseMapNode): string => {
    for (const t of node.topics) {
      const col = colorByTopic.get(t.topicId);
      if (col) return col;
    }
    return MAP_NODE;
  };

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} rx={Radius.md} fill={MAP_BG} />
        {nodes.map((node) => (
          <Circle
            key={node.id}
            cx={pad + node.x * (width - pad * 2)}
            cy={pad + node.y * (height - pad * 2)}
            r={2.4}
            fill={colorFor(node)}
            opacity={0.9}
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
});
