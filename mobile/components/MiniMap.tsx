import React, { useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, Rect, RadialGradient, Stop } from 'react-native-svg';
import { Radius } from '@/constants/theme';
import type { PulseMapCluster, PulseMapEdge, PulseMapNode } from '@/types/api';

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
// Only the densest regions get a halo; past that they overlap into mush.
const HALO_CLUSTERS = 4;
const HALO_MIN_R = 26;

interface Props {
  nodes: PulseMapNode[];
  clusters: PulseMapCluster[];
  edges?: PulseMapEdge[];
  width: number;
  height?: number;
}

/**
 * A miniature, non-interactive rendering of someone's semantic map: their
 * captures placed at their real embedding coordinates, dots colored by the
 * major region each one anchors to, wired together by the connections their
 * memory graph actually holds. A glance-able version of the atlas.
 */
export function MiniMap({ nodes, clusters, edges = [], width, height = 148 }: Props) {
  // SVG ids are global to the surrounding tree, and the pulse renders one map
  // per friend — namespace the gradients so they can't capture each other's.
  const uid = useId().replace(/:/g, '');

  const colorByTopic = useMemo(() => {
    const map = new Map<string, string>();
    clusters
      .filter((cl) => cl.count >= MAJOR_CLUSTER_MIN)
      .sort((a, b) => b.count - a.count)
      .forEach((cl, i) => map.set(cl.topicId, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]));
    return map;
  }, [clusters]);

  const pad = 12;
  const px = (x: number) => pad + x * (width - pad * 2);
  const py = (y: number) => pad + y * (height - pad * 2);

  const colorFor = (node: PulseMapNode): string => {
    for (const t of node.topics) {
      const col = colorByTopic.get(t.topicId);
      if (col) return col;
    }
    return MAP_NODE;
  };

  const { placed, links, halos } = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // Degree first: a capture that everything else hangs off should read as a
    // hub, not as one more identical speck.
    const degree = new Map<string, number>();
    const drawn = edges.filter((e) => byId.has(e.from) && byId.has(e.to));
    for (const e of drawn) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const maxDeg = Math.max(1, ...degree.values());

    const placedNodes = nodes.map((n) => {
      const d = degree.get(n.id) ?? 0;
      return {
        id: n.id,
        cx: px(n.x),
        cy: py(n.y),
        color: colorFor(n),
        r: 2.2 + (d / maxDeg) * 1.6,
        hub: d >= Math.max(3, maxDeg * 0.6),
      };
    });

    const linkList = drawn.map((e, i) => {
      const a = byId.get(e.from)!;
      const b = byId.get(e.to)!;
      return {
        key: `${e.from}-${e.to}-${e.type}-${i}`,
        x1: px(a.x), y1: py(a.y), x2: px(b.x), y2: py(b.y),
        color: colorFor(a),
        // Weight drives presence, but a contradiction is worth seeing even when
        // it's weak — that tension is the interesting part of someone's map.
        opacity: e.type === 'CONTRADICTS' ? 0.34 : 0.1 + Math.min(1, e.weight) * 0.16,
        dashed: e.type === 'CONTRADICTS',
      };
    });

    // A soft wash behind each dense region, so the map reads as territory
    // rather than as loose confetti.
    const haloList = [...colorByTopic.entries()]
      .slice(0, HALO_CLUSTERS)
      .map(([topicId, color], i) => {
        const members = nodes.filter((n) => n.topics.some((t) => t.topicId === topicId));
        if (members.length < MAJOR_CLUSTER_MIN) return null;
        const cx = members.reduce((s, n) => s + px(n.x), 0) / members.length;
        const cy = members.reduce((s, n) => s + py(n.y), 0) / members.length;
        const spread = Math.max(
          ...members.map((n) => Math.hypot(px(n.x) - cx, py(n.y) - cy)),
        );
        return { id: `${uid}-h${i}`, color, cx, cy, r: Math.max(HALO_MIN_R, spread * 1.15) };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    return { placed: placedNodes, links: linkList, halos: haloList };
  }, [nodes, edges, colorByTopic, width, height, uid]);

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          {halos.map((h) => (
            <RadialGradient key={h.id} id={h.id} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={h.color} stopOpacity="0.20" />
              <Stop offset="1" stopColor={h.color} stopOpacity="0" />
            </RadialGradient>
          ))}
        </Defs>
        <Rect x={0} y={0} width={width} height={height} rx={Radius.md} fill={MAP_BG} />

        {halos.map((h) => (
          <Circle key={h.id} cx={h.cx} cy={h.cy} r={h.r} fill={`url(#${h.id})`} />
        ))}

        {links.map((l) => (
          <Line
            key={l.key}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={l.color}
            strokeWidth={0.8}
            strokeOpacity={l.opacity}
            strokeDasharray={l.dashed ? '2,3' : undefined}
          />
        ))}

        {placed.map((n) => (
          <React.Fragment key={n.id}>
            {n.hub && <Circle cx={n.cx} cy={n.cy} r={n.r + 3.2} fill={n.color} opacity={0.16} />}
            <Circle cx={n.cx} cy={n.cy} r={n.r} fill={n.color} opacity={0.9} />
          </React.Fragment>
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
