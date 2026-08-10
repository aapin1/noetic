import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { FontFamily, LetterSpacing, Radius, Spacing } from '@/constants/theme';
import { MAP_BG, MAP_LINE, clusterColorFor, hashId } from '@/constants/mapPalette';
import { Text } from '@/components/ui/Text';
import { RECAP_ASPECT } from '@/lib/recap';
import {
  atlasMonthStamp,
  atlasNodeRadius,
  convexHull,
  darkenHex,
  expandHull,
  fitAtlasFrame,
  mstEdges,
  projectAtlasPoint,
  smoothClosedPath,
} from '@/lib/atlasShare';
import type { TemplatePalette } from '@/lib/recapTemplates';
import type { MemoryGraphResponse } from '@/types/api';

/**
 * The "share your atlas" card: the user's whole semantic map, fit to a 4:5
 * frame, dressed as an annotated star chart. Like the recap cards it takes a
 * resolved template palette instead of the app theme, so the on-screen preview
 * and the captured PNG are the same pixels.
 *
 * The composition explains itself to a stranger — that is the whole design.
 * A serif headline names the artefact, the caption under the chart says what
 * a point is, and field names sit on the map like place names. The chart
 * itself is deliberately quiet: monochrome stars, one thin ink for the
 * constellation lines (a per-field spanning tree, not the full similarity
 * graph, which reads as fuzz at card size), and colour spent ONLY on the
 * field names and their dashed boundaries — annotation, never confetti.
 * Node titles never render here; field names only when the user opts in.
 */

type GraphNodes = MemoryGraphResponse['nodes'];
type GraphEdges = MemoryGraphResponse['edges'];
type GraphClusters = MemoryGraphResponse['clusters'];

const MAJOR_CLUSTER_MIN = 2;
const MAX_LABELS = 7;
/** Hub sparkles only on dense maps — big sparse marks read them as clutter. */
const SPARKLE_MIN_NODES = 25;
const SPECKLE_COUNT = 70;

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

  const panelBg = dark ? MAP_BG : p.surface;
  const starInk = dark ? 'rgba(246,243,235,1)' : '#1A1A1A';
  const linkInk = dark ? MAP_LINE : '#121212';
  const linkOpacity = dark ? 0.32 : 0.2;

  const panelW = width - CARD_PAD * 2;
  const panelH = height - CARD_PAD * 2 - p.barHeight - HEADER_H - FOOTER_H;

  /** Field hue, cut for the ground it sits on: as-is on the dark map, pulled
   *  toward ink on paper where the mid-luminance palette washes out. */
  const fieldColor = useMemo(
    () => (topicId: string) => (dark ? clusterColorFor(topicId) : darkenHex(clusterColorFor(topicId), 0.38)),
    [dark],
  );

  const { speckles, links, hulls, stars, sparkles, labels } = useMemo(() => {
    const positions = new Map(
      nodes.map((n) => [
        n.id,
        typeof n.x === 'number' && typeof n.y === 'number' ? { x: n.x, y: n.y } : scatterOf(n.id),
      ]),
    );
    const fit = fitAtlasFrame([...positions.values()], {
      width: panelW,
      height: panelH,
      pad: Math.max(20, panelW * 0.1),
    });
    if (!fit) return { speckles: [], links: [], hulls: [], stars: [], sparkles: [], labels: [] };
    const at = (id: string) => projectAtlasPoint(positions.get(id)!, fit);

    // Structure comes from the coarse field clusters; topic sub-clusters would
    // double every line and nest hulls inside hulls.
    const domainClusters = clusters.filter((cl) => cl.kind === 'domain' && cl.count >= MAJOR_CLUSTER_MIN);
    const fieldClusters = domainClusters.length > 0
      ? domainClusters
      : clusters.filter((cl) => cl.count >= MAJOR_CLUSTER_MIN);

    // Background star dust: tiny seeded speckles well below node luminance,
    // so the dark panel reads as sky rather than as void.
    const speckleList: { x: number; y: number; r: number; o: number }[] = [];
    if (dark) {
      let h = 9;
      const rand = () => {
        h = (Math.imul(h, 48271) + 11) >>> 0;
        return (h % 10000) / 10000;
      };
      for (let i = 0; i < SPECKLE_COUNT; i++) {
        speckleList.push({
          x: 6 + rand() * (panelW - 12),
          y: 6 + rand() * (panelH - 12),
          r: 0.4 + rand() * 0.5,
          o: 0.1 + rand() * 0.12,
        });
      }
    }

    // Constellation linework: a spanning tree per field, uniform single ink.
    const linkList: { key: string; x1: number; y1: number; x2: number; y2: number; dashed: boolean; opacity: number }[] = [];
    for (const cl of fieldClusters) {
      const members = cl.itemIds.filter((id) => positions.has(id));
      if (members.length < 2) continue;
      const pts = members.map((id) => at(id));
      for (const [i, j] of mstEdges(pts)) {
        linkList.push({
          key: `${cl.topicId}-${i}-${j}`,
          x1: pts[i]!.x, y1: pts[i]!.y, x2: pts[j]!.x, y2: pts[j]!.y,
          dashed: false,
          opacity: linkOpacity,
        });
      }
    }
    // A contradiction is worth seeing even across fields — dashed, restrained.
    for (const e of edges) {
      if (e.type !== 'CONTRADICTS') continue;
      if (!positions.has(e.fromItemId) || !positions.has(e.toItemId)) continue;
      const a = at(e.fromItemId);
      const b = at(e.toItemId);
      linkList.push({
        key: `x-${e.fromItemId}-${e.toItemId}`,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        dashed: true,
        opacity: 0.22,
      });
    }

    // Field boundaries: smoothed dashed hulls, like constellation borders.
    // Only compact clusters get one — a sprawling cluster's hull sweeps across
    // half the chart and tangles with its neighbours instead of naming a region.
    const hullList: { key: string; d: string; color: string }[] = [];
    const maxSpread = Math.min(panelW, panelH) * 0.2;
    for (const cl of fieldClusters) {
      const members = cl.itemIds.filter((id) => positions.has(id));
      if (members.length < 3) continue;
      const pts = members.map((id) => at(id));
      const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
      const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
      const spread = pts.reduce((s, q) => s + Math.hypot(q.x - cx, q.y - cy), 0) / pts.length;
      if (spread > maxSpread) continue;
      hullList.push({
        key: cl.topicId,
        d: smoothClosedPath(expandHull(convexHull(pts), 9)),
        color: fieldColor(cl.topicId),
      });
    }

    // Stars: degree drives size, so the ideas everything hangs off read as hubs.
    const degree = new Map<string, number>();
    for (const e of edges) {
      if (!positions.has(e.fromItemId) || !positions.has(e.toItemId)) continue;
      degree.set(e.fromItemId, (degree.get(e.fromItemId) ?? 0) + 1);
      degree.set(e.toItemId, (degree.get(e.toItemId) ?? 0) + 1);
    }
    const maxDeg = Math.max(1, ...degree.values());
    const baseR = atlasNodeRadius(nodes.length) * 0.9;
    const starList = nodes.map((n) => {
      const d = degree.get(n.id) ?? 0;
      const pt = at(n.id);
      return { id: n.id, cx: pt.x, cy: pt.y, r: baseR * (1 + (d / maxDeg) * 0.6) };
    });

    // Four-point sparkles on the top hubs of a dense map.
    const sparkleList: { id: string; cx: number; cy: number; s: number }[] = [];
    if (nodes.length >= SPARKLE_MIN_NODES) {
      const hubs = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      for (const [id, d] of hubs) {
        if (d < 3 || !positions.has(id)) continue;
        const pt = at(id);
        const star = starList.find((s) => s.id === id);
        sparkleList.push({ id, cx: pt.x, cy: pt.y, s: (star?.r ?? baseR) * 2.6 });
      }
    }

    // Field names, placed like map place-names. Measured-width declutter: try
    // above the cluster then below, take the least node-crowded spot, and skip
    // when everything collides — a missing label beats an overlapping one.
    const labelList: { key: string; text: string; x: number; y: number; color: string }[] = [];
    if (showLabels) {
      const placed: { x: number; y: number; w: number }[] = [];
      const labelW = (text: string) => text.length * 6.7; // ~8.5px mono + tracking
      const collides = (x: number, y: number, w: number) =>
        placed.some((l) => Math.abs(l.y - y) < 13 && Math.abs(l.x - x) < (w + l.w) / 2 + 10);
      const allPts = nodes.map((n) => at(n.id));
      const fields = [...fieldClusters].sort((a, b) => b.count - a.count);
      for (const cl of fields) {
        if (labelList.length >= MAX_LABELS) break;
        const members = cl.itemIds.filter((id) => positions.has(id));
        if (members.length < MAJOR_CLUSTER_MIN) continue;
        const pts = members.map((id) => at(id));
        const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
        const text = cl.name.toUpperCase();
        const w = labelW(text);
        const lx = Math.max(w / 2 + 8, Math.min(panelW - w / 2 - 8, cx));
        const crowding = (x: number, y: number) =>
          allPts.reduce((s, q) => (Math.abs(q.y - y) < 8 && Math.abs(q.x - x) < w / 2 + 6 ? s + 1 : s), 0);
        const top = Math.min(...pts.map((q) => q.y));
        const bottom = Math.max(...pts.map((q) => q.y));
        const candidates = [top - 10, bottom + 15, top - 18, bottom + 23]
          .map((y) => Math.max(12, Math.min(panelH - 8, y)))
          .filter((y) => !collides(lx, y, w))
          .sort((a, b) => crowding(lx, a) - crowding(lx, b));
        if (candidates.length === 0) continue;
        placed.push({ x: lx, y: candidates[0]!, w });
        labelList.push({ key: cl.topicId, text, x: lx, y: candidates[0]!, color: fieldColor(cl.topicId) });
      }
    }

    return { speckles: speckleList, links: linkList, hulls: hullList, stars: starList, sparkles: sparkleList, labels: labelList };
  }, [nodes, edges, clusters, panelW, panelH, dark, linkOpacity, showLabels, fieldColor]);

  const monthStamp = atlasMonthStamp(new Date());

  return (
    <View style={[styles.card, { width, height, backgroundColor: p.surface, borderColor: p.border }]}>
      {p.barHeight > 0 ? <View style={{ height: p.barHeight, backgroundColor: p.accent }} /> : null}
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={[styles.wordmark, { color: p.text }]}>mneme</Text>
          <Text variant="monoSmall" style={[styles.stamp, { color: p.faint }]}>
            {monthStamp}
          </Text>
        </View>
        <Text style={[styles.headline, { color: p.text }]} numberOfLines={1}>
          the shape of my mind
        </Text>

        <View style={[styles.panel, { backgroundColor: panelBg, borderColor: p.border }]}>
          <Svg width={panelW} height={panelH}>
            <Rect x={0} y={0} width={panelW} height={panelH} fill={panelBg} />

            {speckles.map((s, i) => (
              <Circle key={`sp${i}`} cx={s.x} cy={s.y} r={s.r} fill={`rgba(240,232,214,${s.o})`} />
            ))}

            {hulls.map((h) => (
              <Path
                key={h.key}
                d={h.d}
                fill="none"
                stroke={h.color}
                strokeOpacity={dark ? 0.34 : 0.32}
                strokeWidth={0.8}
                strokeDasharray="1.5,3.5"
              />
            ))}

            {links.map((l) => (
              <Line
                key={l.key}
                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={linkInk}
                strokeWidth={0.7}
                strokeOpacity={l.opacity}
                strokeDasharray={l.dashed ? '2,4' : undefined}
              />
            ))}

            {stars.map((n) => (
              <Circle key={n.id} cx={n.cx} cy={n.cy} r={n.r} fill={starInk} />
            ))}

            {sparkles.map((s) => (
              <React.Fragment key={`hub-${s.id}`}>
                <Line x1={s.cx - s.s} y1={s.cy} x2={s.cx + s.s} y2={s.cy} stroke={starInk} strokeWidth={0.6} strokeOpacity={0.55} />
                <Line x1={s.cx} y1={s.cy - s.s} x2={s.cx} y2={s.cy + s.s} stroke={starInk} strokeWidth={0.6} strokeOpacity={0.55} />
              </React.Fragment>
            ))}

            {/* Halo pass then ink pass: a panel-coloured stroke under each
                label lifts the name off the linework it crosses. */}
            {labels.map((l) => (
              <SvgText
                key={`halo-${l.key}`}
                x={l.x} y={l.y}
                fontSize={8.5}
                fontFamily={FontFamily.mono}
                fill="none"
                stroke={panelBg}
                strokeWidth={2.6}
                strokeLinejoin="round"
                textAnchor="middle"
                letterSpacing={1.6}
              >
                {l.text}
              </SvgText>
            ))}
            {labels.map((l) => (
              <SvgText
                key={l.key}
                x={l.x} y={l.y}
                fontSize={8.5}
                fontFamily={FontFamily.mono}
                fill={l.color}
                textAnchor="middle"
                letterSpacing={1.6}
              >
                {l.text}
              </SvgText>
            ))}
          </Svg>
        </View>

        <View style={styles.footer}>
          <Text
            variant="monoSmall"
            style={[styles.caption, { color: p.faint }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            every point is one thing i’ve saved · mapped by meaning
          </Text>
          <View style={styles.statRow}>
            <Text variant="monoSmall" style={[styles.statLine, { color: p.textSecondary }]}>
              {statLine}
            </Text>
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
/** Wordmark row + serif headline above the chart. */
const HEADER_H = 52;
/** Caption + stat row below the chart. */
const FOOTER_H = 54;

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  body: { flex: 1, padding: CARD_PAD },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  wordmark: {
    fontFamily: FontFamily.serif,
    fontSize: 13,
    letterSpacing: LetterSpacing.wide,
    opacity: 0.75,
  },
  stamp: {
    fontSize: 9,
    letterSpacing: 1.5,
  },
  headline: {
    fontFamily: FontFamily.serif,
    fontSize: 21,
    letterSpacing: LetterSpacing.tight,
    marginTop: Spacing[1],
    marginBottom: Spacing[2],
  },
  panel: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  footer: { flex: 1, justifyContent: 'flex-end' },
  caption: {
    fontSize: 9,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[2],
  },
  statLine: {
    letterSpacing: 1.5,
  },
});
