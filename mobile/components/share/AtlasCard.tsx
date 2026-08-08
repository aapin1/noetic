import React, { useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { FontFamily, LetterSpacing, Radius, Spacing } from '@/constants/theme';
import { MAP_BG, MAP_NODE, clusterColorFor, hashId } from '@/constants/mapPalette';
import { Text } from '@/components/ui/Text';
import { RECAP_ASPECT } from '@/lib/recap';
import {
  atlasNodeRadius,
  fitAtlasFrame,
  projectAtlasPoint,
} from '@/lib/atlasShare';
import type { TemplatePalette } from '@/lib/recapTemplates';
import type { MemoryGraphResponse } from '@/types/api';

/**
 * The "share your atlas" card: the user's whole semantic map, fit to a 4:5
 * frame, dressed as a star chart. Like the recap cards it takes a resolved
 * template palette instead of the app theme, so the on-screen preview and the
 * captured PNG are the same pixels.
 *
 * Composition is deliberately spare — constellation, wordmark, one stat line —
 * because the map itself is the thing nobody else can post. Node titles never
 * render here; field labels only when the user opts in.
 */

type GraphNodes = MemoryGraphResponse['nodes'];
type GraphEdges = MemoryGraphResponse['edges'];
type GraphClusters = MemoryGraphResponse['clusters'];

const MAJOR_CLUSTER_MIN = 2;
const HALO_CLUSTERS = 4;
const HALO_MIN_R = 30;
const MAX_LABELS = 6;
/** Min screen distance between two rendered field labels before one yields. */
const LABEL_CLEARANCE = 44;

interface Props {
  p: TemplatePalette;
  width: number;
  handle: string | null;
  nodes: GraphNodes;
  edges: GraphEdges;
  clusters: GraphClusters;
  showLabels: boolean;
  statLine: string;
}

/** Fallback position for a node the server sent without coordinates. */
function scatterOf(id: string): { x: number; y: number } {
  const h = hashId(id);
  return { x: 0.15 + ((h % 997) / 997) * 0.7, y: 0.15 + ((Math.floor(h / 997) % 997) / 997) * 0.7 };
}

export function AtlasShareCard({ p, width, handle, nodes, edges, clusters, showLabels, statLine }: Props) {
  const height = width * RECAP_ASPECT;
  const dark = p.id === 'ink';
  const uid = useId().replace(/:/g, '');

  // The chart's ink: on the dark card the panel is the map's own ground; on
  // the light card it is paper, and the frame furniture flips to near-black.
  const panelBg = dark ? MAP_BG : p.surface;
  const frameInk = dark ? 'rgba(240,232,214,0.5)' : 'rgba(18,18,18,0.45)';
  const frameFaint = dark ? 'rgba(240,232,214,0.16)' : 'rgba(18,18,18,0.12)';
  const baseNode = dark ? MAP_NODE : p.text;

  const panelW = width - CARD_PAD * 2;
  const panelH = height - CARD_PAD * 2 - FOOTER_H;

  const colorByTopic = useMemo(() => {
    // Colour is a stable hash of the topic id (see mapPalette) — the shared
    // card shows the same hues the owner sees on their live Atlas.
    const map = new Map<string, string>();
    clusters
      .filter((cl) => cl.count >= MAJOR_CLUSTER_MIN)
      .sort((a, b) => b.count - a.count)
      .forEach((cl) => map.set(cl.topicId, clusterColorFor(cl.topicId)));
    return map;
  }, [clusters]);

  const { placed, links, halos, labels } = useMemo(() => {
    const positions = new Map(
      nodes.map((n) => [
        n.id,
        typeof n.x === 'number' && typeof n.y === 'number' ? { x: n.x, y: n.y } : scatterOf(n.id),
      ]),
    );
    const fit = fitAtlasFrame([...positions.values()], {
      width: panelW,
      height: panelH,
      pad: Math.max(20, panelW * 0.09),
    });
    if (!fit) return { placed: [], links: [], halos: [], labels: [] };
    const at = (id: string) => projectAtlasPoint(positions.get(id)!, fit);

    const colorFor = (n: GraphNodes[number]): string => {
      for (const t of n.topics) {
        const col = colorByTopic.get(t.topicId);
        if (col) return col;
      }
      return baseNode;
    };

    // Degree drives mark size, so the ideas everything hangs off read as hubs.
    const degree = new Map<string, number>();
    const drawn = edges.filter((e) => positions.has(e.fromItemId) && positions.has(e.toItemId));
    for (const e of drawn) {
      degree.set(e.fromItemId, (degree.get(e.fromItemId) ?? 0) + 1);
      degree.set(e.toItemId, (degree.get(e.toItemId) ?? 0) + 1);
    }
    const maxDeg = Math.max(1, ...degree.values());
    const baseR = atlasNodeRadius(nodes.length);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const placedNodes = nodes.map((n) => {
      const d = degree.get(n.id) ?? 0;
      const pt = at(n.id);
      return {
        id: n.id,
        cx: pt.x,
        cy: pt.y,
        color: colorFor(n),
        r: baseR * (1 + (d / maxDeg) * 0.7),
        hub: d >= Math.max(3, maxDeg * 0.6),
      };
    });

    const linkList = drawn.map((e, i) => {
      const a = at(e.fromItemId);
      const b = at(e.toItemId);
      return {
        key: `${e.fromItemId}-${e.toItemId}-${e.type}-${i}`,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        color: colorFor(byId.get(e.fromItemId)!),
        // A contradiction is worth seeing even when weak — the tension is the
        // interesting part of someone's map (same rule as MiniMap).
        opacity: e.type === 'CONTRADICTS' ? 0.34 : 0.1 + Math.min(1, e.weight) * 0.16,
        dashed: e.type === 'CONTRADICTS',
      };
    });

    // Territory washes behind the densest regions.
    const haloList = [...colorByTopic.entries()]
      .slice(0, HALO_CLUSTERS)
      .map(([topicId, color], i) => {
        const members = nodes.filter((n) => n.topics.some((t) => t.topicId === topicId));
        if (members.length < MAJOR_CLUSTER_MIN) return null;
        const pts = members.map((n) => at(n.id));
        const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
        const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
        const spread = Math.max(...pts.map((q) => Math.hypot(q.x - cx, q.y - cy)));
        return { id: `${uid}-h${i}`, color, cx, cy, r: Math.max(HALO_MIN_R, spread * 1.15) };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    // Field (domain) labels only — coarse enough to share, never node titles.
    // Greedy declutter: biggest fields first, later ones yield when crowded.
    const labelList: { key: string; text: string; x: number; y: number; color: string }[] = [];
    if (showLabels) {
      const fields = clusters
        .filter((cl) => cl.kind === 'domain' && cl.count >= MAJOR_CLUSTER_MIN)
        .sort((a, b) => b.count - a.count);
      for (const cl of fields) {
        if (labelList.length >= MAX_LABELS) break;
        const pts = cl.itemIds.filter((id) => positions.has(id)).map((id) => at(id));
        if (pts.length < MAJOR_CLUSTER_MIN) continue;
        const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
        const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
        if (labelList.some((l) => Math.hypot(l.x - cx, l.y - cy) < LABEL_CLEARANCE)) continue;
        labelList.push({
          key: cl.topicId,
          text: cl.name.toLowerCase(),
          x: Math.max(28, Math.min(panelW - 28, cx)),
          y: Math.max(18, Math.min(panelH - 12, cy)),
          color: clusterColorFor(cl.topicId),
        });
      }
    }

    return { placed: placedNodes, links: linkList, halos: haloList, labels: labelList };
  }, [nodes, edges, clusters, colorByTopic, panelW, panelH, baseNode, showLabels, uid]);

  // Star-chart furniture: corner brackets, edge ticks, registration crosses.
  // Drawn as crisp SVG strokes so the frame reads as an instrument, in the
  // same ascii-terminal register as the app's loaders and the Mono template.
  const B = 16; // bracket arm length
  const chartFrame = (
    <>
      {(
        [
          [4, 4, 1, 1],
          [panelW - 4, 4, -1, 1],
          [4, panelH - 4, 1, -1],
          [panelW - 4, panelH - 4, -1, -1],
        ] as const
      ).map(([x, y, sx, sy], i) => (
        <React.Fragment key={`br${i}`}>
          <Line x1={x} y1={y} x2={x + B * sx} y2={y} stroke={frameInk} strokeWidth={1.2} />
          <Line x1={x} y1={y} x2={x} y2={y + B * sy} stroke={frameInk} strokeWidth={1.2} />
        </React.Fragment>
      ))}
      {/* Midpoint ticks on each edge. */}
      <Line x1={panelW / 2 - 5} y1={4} x2={panelW / 2 + 5} y2={4} stroke={frameFaint} strokeWidth={1} />
      <Line x1={panelW / 2 - 5} y1={panelH - 4} x2={panelW / 2 + 5} y2={panelH - 4} stroke={frameFaint} strokeWidth={1} />
      <Line x1={4} y1={panelH / 2 - 5} x2={4} y2={panelH / 2 + 5} stroke={frameFaint} strokeWidth={1} />
      <Line x1={panelW - 4} y1={panelH / 2 - 5} x2={panelW - 4} y2={panelH / 2 + 5} stroke={frameFaint} strokeWidth={1} />
      {/* Faint registration crosses at the thirds. */}
      {[1, 2].flatMap((ix) =>
        [1, 2].map((iy) => {
          const x = (panelW * ix) / 3;
          const y = (panelH * iy) / 3;
          return (
            <React.Fragment key={`cr${ix}${iy}`}>
              <Line x1={x - 4} y1={y} x2={x + 4} y2={y} stroke={frameFaint} strokeWidth={1} />
              <Line x1={x} y1={y - 4} x2={x} y2={y + 4} stroke={frameFaint} strokeWidth={1} />
            </React.Fragment>
          );
        }),
      )}
    </>
  );

  return (
    <View style={[styles.card, { width, height, backgroundColor: p.surface, borderColor: p.border }]}>
      {p.barHeight > 0 ? <View style={{ height: p.barHeight, backgroundColor: p.accent }} /> : null}
      <View style={styles.body}>
        <View style={[styles.panel, { backgroundColor: panelBg, borderColor: p.border }]}>
          <Svg width={panelW} height={panelH}>
            <Defs>
              {halos.map((h) => (
                <RadialGradient key={h.id} id={h.id} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={h.color} stopOpacity={dark ? '0.2' : '0.12'} />
                  <Stop offset="1" stopColor={h.color} stopOpacity="0" />
                </RadialGradient>
              ))}
            </Defs>
            <Rect x={0} y={0} width={panelW} height={panelH} fill={panelBg} />

            {chartFrame}

            {halos.map((h) => (
              <Circle key={h.id} cx={h.cx} cy={h.cy} r={h.r} fill={`url(#${h.id})`} />
            ))}

            {links.map((l) => (
              <Line
                key={l.key}
                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={l.color}
                strokeWidth={0.9}
                strokeOpacity={l.opacity}
                strokeDasharray={l.dashed ? '2,3' : undefined}
              />
            ))}

            {placed.map((n) => (
              <React.Fragment key={n.id}>
                {n.hub && <Circle cx={n.cx} cy={n.cy} r={n.r + 4} fill={n.color} opacity={0.16} />}
                <Circle cx={n.cx} cy={n.cy} r={n.r} fill={n.color} opacity={0.92} />
              </React.Fragment>
            ))}

            {labels.map((l) => (
              <SvgText
                key={l.key}
                x={l.x}
                y={l.y}
                fontSize={10.5}
                fontFamily={FontFamily.mono}
                fill={l.color}
                fillOpacity={0.95}
                textAnchor="middle"
                letterSpacing={1.5}
              >
                {l.text}
              </SvgText>
            ))}
          </Svg>
        </View>

        <View style={styles.footer}>
          <Text variant="monoSmall" style={[styles.statLine, { color: p.textSecondary }]}>
            {statLine}
          </Text>
          <View style={styles.brandRow}>
            <Text style={[styles.wordmark, { color: p.text }]}>mneme</Text>
            {handle ? (
              <Text variant="monoSmall" style={{ color: p.faint }} numberOfLines={1}>
                @{handle}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const CARD_PAD = Spacing[5];
/** Vertical room the stat line + brand row take below the chart. */
const FOOTER_H = 64;

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  body: { flex: 1, padding: CARD_PAD },
  panel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  footer: { flex: 1, justifyContent: 'flex-end' },
  statLine: {
    textAlign: 'center',
    letterSpacing: 2,
    marginTop: Spacing[3],
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[3],
  },
  wordmark: {
    fontFamily: FontFamily.serif,
    fontSize: 13,
    letterSpacing: LetterSpacing.wide,
    opacity: 0.75,
  },
});
