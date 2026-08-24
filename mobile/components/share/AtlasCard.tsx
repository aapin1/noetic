import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { FontFamily, LetterSpacing, Radius, Spacing } from '@/constants/theme';
import { MAP_BG, MAP_LINE, MAP_NODE, clusterColorFor, hashId } from '@/constants/mapPalette';
import { Text } from '@/components/ui/Text';
import { RECAP_ASPECT, SHARE_CTA } from '@/lib/recap';
import { atlasMonthStamp, buildAtlasScene, darkenHex } from '@/lib/atlasShare';
import type { TemplatePalette } from '@/lib/recapTemplates';
import type { MemoryGraphResponse } from '@/types/api';

/**
 * The "share your atlas" card: the user's whole semantic map, fit to a 4:5
 * frame, drawn in the live Atlas's own grammar so the card looks like the
 * thing it advertises. Like the recap cards it takes a resolved template
 * palette instead of the app theme, so the on-screen preview and the captured
 * PNG are the same pixels.
 *
 * The composition explains itself to a stranger: a serif headline names the
 * artefact, the stat line says how big it is, the caption says what a dot and
 * a line are, and the footer says where to get one. The chart itself is the
 * Atlas at a glance — soft colour wash per field, one ink for the points,
 * edges faded by weight, and each field named by a colour dot + mono caption
 * parked beside its points, never across them. Node titles never render;
 * field names only when the user opts in. Layout is computed in
 * lib/atlasShare.ts (buildAtlasScene); this file only draws it.
 */

interface Props {
  p: TemplatePalette;
  width: number;
  handle: string | null;
  nodes: MemoryGraphResponse['nodes'];
  edges: MemoryGraphResponse['edges'];
  clusters: MemoryGraphResponse['clusters'];
  showLabels: boolean;
  statLine: string;
}

export function AtlasShareCard({ p, width, handle, nodes, edges, clusters, showLabels, statLine }: Props) {
  const height = width * RECAP_ASPECT;
  const dark = p.id === 'ink';

  const panelBg = dark ? MAP_BG : '#FBFAF7';
  const starInk = dark ? MAP_NODE : '#2B2B2B';
  const linkInk = dark ? MAP_LINE : '#1A1A1A';
  const labelInk = dark ? 'rgba(236,240,246,0.88)' : 'rgba(20,20,20,0.8)';

  const panelW = width - CARD_PAD * 2;
  const panelH = height - CARD_PAD * 2 - p.barHeight - HEADER_H - FOOTER_H;

  const scene = useMemo(
    () => buildAtlasScene(nodes, edges, clusters, {
      width: panelW,
      height: panelH,
      showLabels,
      colorFor: clusterColorFor,
      hash: hashId,
    }),
    [nodes, edges, clusters, panelW, panelH, showLabels],
  );

  const hubs = scene.stars.filter((s) => s.hub);

  return (
    <View style={[styles.card, { width, height, backgroundColor: p.surface, borderColor: p.border }]}>
      {p.barHeight > 0 ? <View style={{ height: p.barHeight, backgroundColor: p.accent }} /> : null}
      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={[styles.headline, { color: p.text }]} numberOfLines={1}>
              my mind, mapped
            </Text>
            <Text variant="monoSmall" style={[styles.stamp, { color: p.faint }]}>
              {atlasMonthStamp(new Date())}
            </Text>
          </View>
          <Text variant="monoSmall" style={[styles.statLine, { color: p.textSecondary }]} numberOfLines={1}>
            {statLine.toUpperCase()}
          </Text>
        </View>

        <View style={[styles.panel, { backgroundColor: panelBg, borderColor: p.border }]}>
          <Svg width={panelW} height={panelH}>
            <Defs>
              {scene.washes.map((w) => (
                <RadialGradient key={w.key} id={`wash-${w.key}`} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                  <Stop offset="0%" stopColor={w.color} stopOpacity={dark ? 0.24 : 0.2} />
                  <Stop offset="55%" stopColor={w.color} stopOpacity={dark ? 0.08 : 0.06} />
                  <Stop offset="100%" stopColor={w.color} stopOpacity={0} />
                </RadialGradient>
              ))}
              <RadialGradient id="hubGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                <Stop offset="0%" stopColor={starInk} stopOpacity={1} />
                <Stop offset="24%" stopColor={starInk} stopOpacity={0.4} />
                <Stop offset="55%" stopColor={starInk} stopOpacity={0.08} />
                <Stop offset="100%" stopColor={starInk} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={panelW} height={panelH} fill={panelBg} />

            {scene.washes.map((w) => (
              <Circle key={w.key} cx={w.cx} cy={w.cy} r={w.r} fill={`url(#wash-${w.key})`} />
            ))}

            {scene.links.map((l) => (
              <Line
                key={l.key}
                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={linkInk}
                strokeWidth={l.width}
                strokeOpacity={dark ? l.opacity : l.opacity * 0.7}
                strokeDasharray={l.dashed ? '2,3' : undefined}
              />
            ))}

            {hubs.map((s) => (
              <Circle key={`glow-${s.id}`} cx={s.cx} cy={s.cy} r={s.r * 4} fill="url(#hubGlow)" fillOpacity={0.35} />
            ))}

            {scene.stars.map((s) => (
              <Circle key={s.id} cx={s.cx} cy={s.cy} r={dark ? s.r : s.r * 0.82} fill={starInk} />
            ))}

            {/* Dot + name, over a translucent plate so a label stays readable
                where it crosses a line without ever hiding a point outright. */}
            {scene.labels.map((l) => {
              const dot = l.fontSize * 0.5;
              const x0 = l.x - l.width / 2;
              return (
                <React.Fragment key={l.key}>
                  <Rect
                    x={x0 - 5} y={l.y - l.fontSize * 0.85}
                    width={l.width + 10} height={l.fontSize * 1.25}
                    rx={3}
                    fill={panelBg}
                    fillOpacity={0.72}
                  />
                  <Circle
                    cx={x0 + dot / 2} cy={l.y - l.fontSize * 0.32} r={dot / 2}
                    fill={dark ? l.color : darkenHex(l.color, 0.25)}
                  />
                  <SvgText
                    x={x0 + dot + l.fontSize * 0.55} y={l.y}
                    fontSize={l.fontSize}
                    fontFamily={FontFamily.mono}
                    fill={labelInk}
                    letterSpacing={l.fontSize * 0.08}
                  >
                    {l.text}
                  </SvgText>
                </React.Fragment>
              );
            })}
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
            dots = things i saved · lines = related ideas
          </Text>
          <View style={styles.ctaRow}>
            <Text variant="monoSmall" style={{ color: p.textSecondary }} numberOfLines={1}>
              <Text style={[styles.wordmark, { color: p.text }]}>mneme</Text>
              {` · ${SHARE_CTA}`}
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
/** Serif headline + stamp row, then the stat line. */
const HEADER_H = 58;
/** Caption + CTA row below the chart. */
const FOOTER_H = 62;

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  body: { flex: 1, padding: CARD_PAD },
  header: { height: HEADER_H },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headline: {
    fontFamily: FontFamily.serif,
    fontSize: 22,
    letterSpacing: LetterSpacing.tight,
    flex: 1,
  },
  stamp: {
    fontSize: 9,
    letterSpacing: 1.5,
  },
  statLine: {
    fontSize: 10,
    letterSpacing: 1.2,
    marginTop: Spacing[1],
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
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[2],
    gap: Spacing[3],
  },
  wordmark: {
    fontFamily: FontFamily.serif,
    fontSize: 12,
    letterSpacing: LetterSpacing.wide,
  },
});
