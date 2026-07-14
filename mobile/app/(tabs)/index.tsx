import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated as RNAnimated,
  Dimensions,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { ChevronDown, ChevronUp, Crosshair, Moon, Search, Sun, Trash2Icon, type LucideIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { takeRecentSharedCapture } from '@/lib/lastShared';
import { prefetchQuery, useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme, useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { useTutorial, useTutorialTarget } from '@/contexts/TutorialContext';
import { TUTORIAL_DEMO_NODE, TUTORIAL_EXAMPLE_LINK, TUTORIAL_TARGET } from '@/constants/tutorialSteps';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import type { AppThemeColors } from '@/constants/theme';
import type {
  CaptureKind,
  CapturePreflight,
  MemoryGraphResponse,
} from '@/types/api';

type GraphNode = MemoryGraphResponse['nodes'][number];
type GraphEdge = MemoryGraphResponse['edges'][number];

const { width: SW, height: SH } = Dimensions.get('window');
const TAB_H = Platform.OS === 'ios' ? 86 : 68;
const FAB_SIZE = 64;
// Just barely larger than the button itself — a subtle breathing ring, not a halo.
const FAB_GLOW_SIZE = FAB_SIZE * 1.14;
// Mirrors the global SocraticFab's position (app/(tabs)/_layout.tsx) — it
// floats above the tab bar on the same right edge as the timeline rail, so
// the rail's bottom bound must clear it, not just the tab bar.
const SOCRATIC_FAB_BOTTOM = Platform.OS === 'ios' ? 104 : 86;
const SOCRATIC_FAB_SIZE = 50;

// Always-dark map colors (map is always dark regardless of theme)
const MAP_BG = '#060606';
const MAP_NODE = 'rgba(236,236,236,0.9)';
const MAP_LINE = 'rgba(255,255,255,0.92)';
// Green accent shared by every discovery/multi-select affordance.
const DISCOVERY_ACCENT = '#7EC8A0';
// Stable identity for an edge, independent of its array index.
const edgeKey = (fromItemId: string, toItemId: string) => `${fromItemId}__${toItemId}`;

// ── Edge salience ─────────────────────────────────────────────
// Edge count grows superlinearly in nodes, so painting every edge at a similar
// weight turns the map into a hairball. Salience (0..1) drives both opacity and
// width, so a node's few real connections read as connections and the long tail
// recedes into texture rather than competing with them.
//
// `weight` is embedding cosine similarity. The backend only creates an edge at
// >=0.30, and >=0.75 is a near-restatement, so the useful signal lives in that
// band — anchor the ramp there rather than to the observed min/max, which would
// make an edge's appearance depend on whatever else is on screen.
const EDGE_WEIGHT_FLOOR = 0.3;
const EDGE_WEIGHT_CEIL = 0.75;
// Similarity is bunched near the floor. Squaring pulls the crowd down without
// touching the top, which is what actually separates the strong few.
const EDGE_WEIGHT_GAMMA = 2;
// Rank an edge holds among its endpoints' edges, best endpoint wins. The top
// two keep full salience — those are the "this connects to that" lines the map
// exists to show. Past that, each further rank costs ~45%.
const EDGE_FULL_RANK = 2;
const EDGE_RANK_FALLOFF = 0.55;
// Fading distant ranks isn't enough at a hub — a node with 20 edges still
// paints 20 faint overlapping lines, and those stack into visual clutter.
// Hard-cut past a node's few strongest connections instead of just dimming.
const EDGE_MAX_RANK = 4;
// Every edge stays readable — a weak connection is faint but never invisible —
// while the strongest land as a thin, subdued line, never a bold one. MAP_LINE
// is near-white, so these opacities are effectively the on-screen alpha.
const EDGE_MIN_OPACITY = 0.05;
const EDGE_MAX_OPACITY = 0.28;
const EDGE_MIN_WIDTH = 0.35;
const EDGE_MAX_WIDTH = 0.9;

const edgeSalience = (weight: number, rank: number) => {
  const t = Math.max(0, Math.min(1, (weight - EDGE_WEIGHT_FLOOR) / (EDGE_WEIGHT_CEIL - EDGE_WEIGHT_FLOOR)));
  const byWeight = Math.pow(t, EDGE_WEIGHT_GAMMA);
  const byRank = rank < EDGE_FULL_RANK ? 1 : Math.pow(EDGE_RANK_FALLOFF, rank - EDGE_FULL_RANK + 1);
  return byWeight * byRank;
};

// Layout area — nodes distributed within this space
const LAYOUT_W = SW * 2.2;
const LAYOUT_H = SH * 2.0;

// Pannable padding around the layout area
const MAP_PAD = SW * 1.4;

// Total canvas
const CANVAS_W = LAYOUT_W + MAP_PAD * 2;
const CANVAS_H = LAYOUT_H + MAP_PAD * 2;

// Initial view centers on the layout area
const INIT_VB_X = MAP_PAD + (LAYOUT_W - SW) / 2;
const INIT_VB_Y = MAP_PAD + (LAYOUT_H - SH) / 2;

const ZOOM_MIN = 0.22;
const ZOOM_MAX = 5.0;
const SCRUBBER_H = 80;

// ── Overscan ──────────────────────────────────────────────────────────
// An <Svg> clips to its own width/height, so a screen-sized world SVG holds
// nothing beyond the viewport it was rendered for: the instant the wrapper
// transform moves it, the strip it uncovers is bare. That is the "uncharted"
// flash — no drift threshold can fix it, because at zero overscan *any*
// movement gaps. So render a margin of real map past every edge and let
// gestures reveal charted territory.
//
// Cost is bounded and cheap: the same nodes/edges are drawn either way (the
// graph is never culled per-node), only the SVG's backing layer grows —
// ~2.9× screen area here. No extra React work, no extra work per frame.
const OVERSCAN_PX = Math.round(SW * 0.5);
const MARGIN_X = OVERSCAN_PX;
const MARGIN_Y = OVERSCAN_PX;
const OS_W = SW + MARGIN_X * 2;
const OS_H = SH + MARGIN_Y * 2;

// Re-render once the painted map extends less than this far past any viewport
// edge. Headroom for one fast frame (a finger tops out near ~50px/frame), so
// motion can never jump the remaining margin between two checks.
const RECOMMIT_SLACK = 64;

// Anchor the raster AHEAD of the camera, along its direction of travel. A
// centred anchor wastes half the overscan behind you, so a fast pan burns
// through the leading margin and re-rasterizes twice as often as it needs to.
// Leading roughly doubles the distance covered per commit — the single
// cheapest way to smooth out fast, sudden movement, since it costs no extra
// pixels. Must stay under MARGIN − RECOMMIT_SLACK, or the trailing edge would
// land inside the threshold and re-fire immediately.
const RECOMMIT_LEAD_MAX = 120;
const LEAD_FRAMES = 6;
const VEL_EMA = 0.4;
// Zooming in never shrinks coverage; this recommit only re-rasterizes the
// vectors before the scaled-up layer goes visibly soft. Zoom-out needs no
// threshold of its own — it shrinks the layer, so the slack check catches it.
const RECOMMIT_ZOOM_IN = 1.4;

// Fixed raster size for the ambient glow, scaled to canvas size by a view
// transform. It is one smooth gradient, so it survives any upscale.
const GLOW_W = 640;
const GLOW_H = (GLOW_W * CANVAS_H) / CANVAS_W;

// Static: the world SVG is always offset by exactly the overscan margin.
const MAP_WORLD_STYLE = { position: 'absolute' as const, left: -MARGIN_X, top: -MARGIN_Y };

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

// Recent threshold: 14 days
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

// One-time flag: the first time a source can't be read, a popup explains why
// and what the "what was it about?" box is for. Never shown again after that.
const UNREADABLE_EXPLAINED_KEY = 'mneme_unreadable_source_explained';

// ── Types ─────────────────────────────────────────────────────────

type LensMode = 'semantic' | 'temporal';
type ToolMode = 'default' | 'discover' | 'search';
type PositionMap = Record<string, { x: number; y: number }>;

// ── Layout helpers ─────────────────────────────────────────────────

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

function seededRng(seed: number) {
  let v = seed % 233280 || 1;
  return () => {
    v = (v * 9301 + 49297) % 233280;
    return v / 233280;
  };
}

const MAJOR_CLUSTER_MIN = 2;

const EDGE_PULL: Record<string, number> = {
  RECURS: 0.42,
  REINFORCES: 0.30,
  CONTRADICTS: -0.12,
  EVOLVES_FROM: 0.22,
  RELATED: 0.14,
};

// Semantic (force-directed by topic)
function layoutGraph(
  nodes: GraphNode[],
  clusters: MemoryGraphResponse['clusters'],
  edges: GraphEdge[],
  w: number,
  h: number,
): PositionMap {
  const pos: PositionMap = {};
  if (nodes.length === 0) return pos;

  const cx = w / 2;
  const cy = h * 0.44;
  const pad = 30;

  const majorClusters = clusters.filter((cl) => cl.count >= MAJOR_CLUSTER_MIN);

  if (majorClusters.length === 0) {
    nodes.forEach((node, i) => {
      const rng = seededRng(hashId(node.id));
      const r = Math.min(w, h) * (0.12 + rng() * 0.28);
      const angle = (i / nodes.length) * Math.PI * 2;
      pos[node.id] = {
        x: Math.max(pad, Math.min(w - pad, cx + r * Math.cos(angle))),
        y: Math.max(pad, Math.min(h - pad, cy + r * Math.sin(angle))),
      };
    });
  } else {
    const centres: Record<string, { x: number; y: number }> = {};
    const cr = Math.min(w, h) * 0.27;
    majorClusters.forEach((cl, i) => {
      const angle = (i / majorClusters.length) * Math.PI * 2 - Math.PI / 2;
      centres[cl.topicId] = { x: cx + cr * Math.cos(angle), y: cy + cr * Math.sin(angle) };
    });
    const topicToCentre = new Map(Object.entries(centres));
    nodes.forEach((node) => {
      const anchorTopic = node.topics.find((t) => topicToCentre.has(t.topicId));
      const centre = anchorTopic ? topicToCentre.get(anchorTopic.topicId)! : { x: cx, y: cy };
      const rng = seededRng(hashId(node.id));
      const jr = 18 + rng() * 52;
      const ja = rng() * Math.PI * 2;
      pos[node.id] = {
        x: Math.max(pad, Math.min(w - pad, centre.x + jr * Math.cos(ja))),
        y: Math.max(pad, Math.min(h - pad, centre.y + jr * Math.sin(ja))),
      };
    });
  }

  const nodeList = nodes.map((n) => n.id);
  const nodeSet = new Set(nodeList);
  const ITERATIONS = 20;
  const K_REPEL = 1800;
  const MAX_DISP = 40;

  const topicToNodes = new Map<string, string[]>();
  for (const node of nodes) {
    for (const t of node.topics) {
      const arr = topicToNodes.get(t.topicId) ?? [];
      arr.push(node.id);
      topicToNodes.set(t.topicId, arr);
    }
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const damping = 1 - iter / ITERATIONS;
    const disp: Record<string, { dx: number; dy: number }> = {};
    for (const id of nodeList) disp[id] = { dx: 0, dy: 0 };

    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const a = pos[nodeList[i]]!;
        const b = pos[nodeList[j]]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = Math.max(1, dx * dx + dy * dy);
        const force = K_REPEL / distSq;
        const dist = Math.sqrt(distSq);
        disp[nodeList[i]]!.dx += (dx / dist) * force;
        disp[nodeList[i]]!.dy += (dy / dist) * force;
        disp[nodeList[j]]!.dx -= (dx / dist) * force;
        disp[nodeList[j]]!.dy -= (dy / dist) * force;
      }
    }

    for (const edge of edges) {
      if (!nodeSet.has(edge.fromItemId) || !nodeSet.has(edge.toItemId)) continue;
      const a = pos[edge.fromItemId]!;
      const b = pos[edge.toItemId]!;
      const basePull = EDGE_PULL[edge.type] ?? 0.12;
      const factor = basePull * Math.min(edge.weight * 1.8, 1.0);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      disp[edge.fromItemId]!.dx += dx * factor;
      disp[edge.fromItemId]!.dy += dy * factor;
      disp[edge.toItemId]!.dx -= dx * factor;
      disp[edge.toItemId]!.dy -= dy * factor;
    }

    for (const members of topicToNodes.values()) {
      if (members.length < 2) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = pos[members[i]]!;
          const b = pos[members[j]]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const factor = 0.06;
          disp[members[i]]!.dx += dx * factor;
          disp[members[i]]!.dy += dy * factor;
          disp[members[j]]!.dx -= dx * factor;
          disp[members[j]]!.dy -= dy * factor;
        }
      }
    }

    for (const id of nodeList) {
      const d = disp[id]!;
      const mag = Math.sqrt(d.dx * d.dx + d.dy * d.dy);
      const scale = mag > MAX_DISP ? (MAX_DISP / mag) * damping : damping;
      const p = pos[id]!;
      pos[id] = {
        x: Math.max(pad, Math.min(w - pad, p.x + d.dx * scale)),
        y: Math.max(pad, Math.min(h - pad, p.y + d.dy * scale)),
      };
    }
  }

  return pos;
}

// Semantic (deterministic server-computed embedding coordinates).
// Server returns normalized [0,1] x/y per node; map them into layout space.
// Returns null when coordinates are absent/degenerate (all identical), so the
// caller can fall back to the local force layout.
function layoutSemanticFromServer(nodes: GraphNode[], w: number, h: number): PositionMap | null {
  if (nodes.length === 0) return null;
  const hasCoords = nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number');
  if (!hasCoords) return null;
  const distinct = new Set(nodes.map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`));
  if (distinct.size < Math.min(2, nodes.length)) return null;

  const pad = 30;
  const pos: PositionMap = {};
  for (const node of nodes) {
    pos[node.id] = {
      x: Math.max(pad, Math.min(w - pad, node.x * w)),
      y: Math.max(pad, Math.min(h - pad, node.y * h)),
    };
  }
  return pos;
}

// Source (grouped by capture kind)
function applyLayoutOffset(raw: PositionMap): PositionMap {
  const result: PositionMap = {};
  for (const [id, p] of Object.entries(raw)) {
    result[id] = { x: p.x + MAP_PAD, y: p.y + MAP_PAD };
  }
  return result;
}

function clampVBX(v: number, vbW = SW) {
  return Math.max(0, Math.min(CANVAS_W - vbW, v));
}
function clampVBY(v: number, vbH = SH) {
  return Math.max(0, Math.min(CANVAS_H - vbH, v));
}

// Bounding-box camera fit for a given set of node positions. Pure so it can be
// recomputed every frame against in-flight (tweened) positions — deriving the
// camera from whatever is currently on screen, rather than flying toward a
// separately-eased target. Two independently-eased tweens (node position and
// camera zoom/pan) combine multiplicatively in screen space
// (screenX = (nodeX - camX) * zoom) and produce a non-monotonic path — visible
// as nodes overshooting/reversing mid-transition — unless camera and node
// motion are derived from the same live positions every frame.
function computeCameraFit(nodes: GraphNode[], positions: PositionMap): { x: number; y: number; zoom: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let count = 0;
  for (const node of nodes) {
    const p = positions[node.id];
    if (!p) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    count++;
  }
  if (count === 0) return null;

  const PAD = 72;
  const boundsW = maxX - minX + PAD * 2;
  const boundsH = maxY - minY + PAD * 2;
  const fitZoom = Math.min(SW / boundsW, (SH - TAB_H) / boundsH, 2.5);
  const zoom = Math.max(ZOOM_MIN, fitZoom);
  const vbW = SW / zoom;
  const vbH = SH / zoom;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    x: clampVBX(centerX - vbW / 2, vbW),
    y: clampVBY(centerY - vbH / 2, vbH),
    zoom,
  };
}

// ── Capture step components ────────────────────────────────────────

type CaptureMode = 'link' | 'text' | 'image';

function normalizeLinkInput(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#]|$)/i.test(v)) return `https://${v}`;
  return v;
}

function Divider({ c }: { c: AppThemeColors }) {
  return <View style={[sh.divider, { backgroundColor: c.border }]} />;
}

function StepOne({
  mode, setMode, payload, setPayload, imageUri, uploading, onPickImage, error, onNext, onClose, onPaste, c, firstCapture,
  onQuickSave, busy, clipboardHasUrl,
}: {
  mode: CaptureMode; setMode: (m: CaptureMode) => void;
  payload: string; setPayload: (s: string) => void;
  imageUri: string | null; uploading: boolean; onPickImage: (source: 'camera' | 'library') => void;
  error: string; onNext: () => boolean; onClose: () => void; onPaste: () => void;
  c: AppThemeColors;
  firstCapture?: boolean;
  onQuickSave: () => void; busy: boolean; clipboardHasUrl: boolean;
}) {
  const nextTarget = useTutorialTarget(TUTORIAL_TARGET.captureNext);
  // The copied-link fast path: when the clipboard is known to hold a URL and
  // nothing has been typed yet, the paste affordance is promoted from a muted
  // hint to the obvious next tap.
  const promotePaste = mode === 'link' && clipboardHasUrl && !payload.trim();
  return (
    <View>
      <Text variant="serifLg" color="primary" style={sh.heading}>
        {firstCapture ? 'Your first capture.' : 'What are you saving?'}
      </Text>
      <Text variant="monoSmall" color="muted" style={sh.sub}>
        {firstCapture
          ? 'start with the last link that made you think — or any thought in your head.'
          : 'A link, thought, or image.'}
      </Text>
      <Divider c={c} />
      <View style={sh.modeRow}>
        {(['link', 'text', 'image'] as CaptureMode[]).map((m) => {
          const active = mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[sh.modeChip, { borderColor: active ? c.text : c.borderSubtle, backgroundColor: active ? c.elevated : 'transparent' }]}
            >
              <Text variant="monoSmall" style={{ color: active ? c.text : c.muted }}>
                {m.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Wrapped as one region so the tutorial's spotlight (and its tap
          passthrough) covers the whole visible form, not just the button. */}
      <View ref={nextTarget.ref} onLayout={nextTarget.onLayout}>
        {mode === 'image' ? (
          <View style={[sh.inputBox, { borderColor: c.border }]}>
            <Text variant="monoSmall" style={[sh.inputLabel, { color: c.muted }]}>IMAGE_</Text>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={sh.thumb} contentFit="cover" />
            ) : (
              <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[3], fontSize: FontSize.base }}>
                a screenshot, book page, or photo.
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[3] }}>
              <Pressable onPress={() => onPickImage('camera')} style={[sh.modeChip, { borderColor: c.borderSubtle }]}>
                <Text variant="monoSmall" style={{ color: c.text }}>take photo</Text>
              </Pressable>
              <Pressable onPress={() => onPickImage('library')} style={[sh.modeChip, { borderColor: c.borderSubtle }]}>
                <Text variant="monoSmall" style={{ color: c.text }}>{imageUri ? 'replace ↑' : 'choose ↑'}</Text>
              </Pressable>
            </View>
            {uploading && (
              <Text variant="monoSmall" style={{ color: c.muted, marginTop: Spacing[3] }}>reading image…</Text>
            )}
          </View>
        ) : (
          <View style={[sh.inputBox, { borderColor: c.border }]}>
            <Text variant="monoSmall" style={[sh.inputLabel, { color: c.muted }]}>
              {mode === 'link' ? 'URL_' : 'THOUGHT_'}
            </Text>
            <TextInput
              style={[sh.inputField, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
              value={payload}
              onChangeText={setPayload}
              placeholder={mode === 'link' ? 'https://...' : 'a thought, a quote, a fragment.'}
              placeholderTextColor={c.faint}
              multiline={mode !== 'link'}
              autoCapitalize={mode === 'link' ? 'none' : 'sentences'}
              keyboardType={mode === 'link' ? 'url' : 'default'}
              autoFocus={!nextTarget.isActive}
            />
            <Pressable onPress={onPaste} accessibilityLabel="Paste from clipboard">
              {promotePaste ? (
                <View style={[sh.clipChip, { borderColor: c.border, backgroundColor: c.elevated }]}>
                  <Text variant="monoSmall" style={{ color: c.text }}>↳ use copied link</Text>
                </View>
              ) : (
                <Text variant="monoSmall" style={{ color: c.muted, marginTop: Spacing[3] }}>paste from clipboard ↑</Text>
              )}
            </Pressable>
          </View>
        )}
        {!!error && (
          <Text variant="monoSmall" color="danger" style={{ marginTop: Spacing[3] }}>{error}</Text>
        )}
        <Divider c={c} />
        <View style={sh.actions}>
          {/* Locked while this step is guided: closing here would leave the
              walkthrough pointing at a form that no longer exists. The card's
              own exit remains the way out. */}
          <Pressable onPress={onClose} disabled={nextTarget.isActive} style={[sh.secondaryBtn, { opacity: nextTarget.isActive ? 0.35 : 1 }]}>
            <Text variant="monoSmall" style={{ color: c.muted }}>close ✕</Text>
          </Pressable>
          {nextTarget.isActive ? (
            /* Guided flow: the walkthrough teaches the full two-step capture,
               so its step one keeps the original single "next" action. */
            <Pressable
              // Advance the walkthrough only when the form actually advanced —
              // a validation error must keep the tutorial on this step too.
              onPress={() => { if (onNext()) nextTarget.press(); }}
              style={[sh.primaryBtn, { backgroundColor: c.text }]}
            >
              <Text variant="monoSmall" style={{ color: c.background }}>next →</Text>
            </Pressable>
          ) : (
            /* Real captures are one step: save commits right here. The
               reaction remains available as an optional detour, matching how
               the share-sheet path treats the insight — an offer, not a toll. */
            <View style={sh.actionsRight}>
              <Pressable onPress={() => { onNext(); }} disabled={busy} style={sh.secondaryBtn}>
                <Text variant="monoSmall" style={{ color: c.muted }}>+ reaction</Text>
              </Pressable>
              <Pressable
                onPress={onQuickSave}
                disabled={busy}
                style={[sh.primaryBtn, { backgroundColor: c.text, opacity: busy ? 0.55 : 1 }]}
              >
                <Text variant="monoSmall" style={{ color: c.background }}>
                  {busy ? 'saving...' : 'save →'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/** What the preflight read of the source yielded, shown on the reaction step. */
function PreflightStatus({ loading, preflight, c }: {
  loading: boolean;
  preflight: CapturePreflight | null;
  c: AppThemeColors;
}) {
  // While the source is being read, show a live line so the wait is clearly
  // the app working — the greyed-out Commit button alone read as "stuck".
  if (loading) {
    return (
      <View style={sh.preflightRow}>
        <LoadingDots size={4} />
        <Text variant="monoSmall" style={{ color: c.muted }}>reading the source…</Text>
      </View>
    );
  }
  if (!preflight) return null;
  if (preflight.confidence === 'rich') {
    const label = preflight.bodySource === 'transcript' ? 'got the full transcript ✓' : 'read the full content ✓';
    return (
      <View style={sh.preflightRow}>
        <Text variant="monoSmall" style={{ color: c.muted }}>{label}</Text>
      </View>
    );
  }
  if (preflight.confidence === 'partial') {
    return (
      <View style={sh.preflightRow}>
        <Text variant="monoSmall" style={{ color: c.muted }}>only got a short excerpt of this source.</Text>
      </View>
    );
  }
  return (
    <View style={sh.preflightRow}>
      <Text variant="monoSmall" color="danger">couldn't read this source.</Text>
    </View>
  );
}

function StepTwo({
  reaction, setReaction, error, busy, onBack, onCommit, c,
  isLink, preflight, preflightLoading, userContext, setUserContext, onVoiceError,
}: {
  reaction: string; setReaction: (s: string) => void;
  error: string; busy: boolean; onBack: () => void; onCommit: () => void;
  c: AppThemeColors;
  isLink: boolean;
  preflight: CapturePreflight | null;
  preflightLoading: boolean;
  userContext: string; setUserContext: (s: string) => void;
  onVoiceError: (message: string) => void;
}) {
  // The fail-safe: when we couldn't read the source (or barely could), the
  // user's own account becomes the ground truth the insight pipeline works from.
  const needsContext = isLink && !preflightLoading && !!preflight && preflight.confidence !== 'rich';
  const contextThin = preflight?.confidence === 'thin';
  // Commit is never gated on the preflight: the server dedupes a racing
  // scrape (createManualContentItem catches the unique-key collision), and if
  // the source turns out unreadable the insight screen asks for the user's
  // own account afterwards. Waiting here was pure friction.
  const commitDisabled = busy;
  const commitTarget = useTutorialTarget(TUTORIAL_TARGET.captureCommit);

  return (
    <View>
      <Text variant="serifLg" color="primary" style={sh.heading}>Your reaction.</Text>
      <Text variant="monoSmall" color="muted" style={sh.sub}>Optional — just for you.</Text>
      {isLink && <PreflightStatus loading={preflightLoading} preflight={preflight} c={c} />}
      <Divider c={c} />
      {/* Wrapped as one region so the tutorial's spotlight (and its tap
          passthrough) covers the reaction box, the context/voice fallback
          when it appears, and the commit button together. */}
      <View ref={commitTarget.ref} onLayout={commitTarget.onLayout}>
        <View style={[sh.inputBox, { borderColor: c.border }]}>
          <TextInput
            style={[sh.inputField, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
            value={reaction}
            onChangeText={setReaction}
            placeholder="one line, or nothing."
            placeholderTextColor={c.faint}
            multiline
            autoFocus={!needsContext && !commitTarget.isActive}
          />
        </View>
        {needsContext && (
          <View style={[sh.inputBox, { borderColor: contextThin ? c.danger : c.border }]}>
            <View style={sh.contextHeader}>
              <Text variant="monoSmall" style={[sh.inputLabel, { color: contextThin ? c.danger : c.muted }]}>
                WHAT WAS IT ABOUT?_
              </Text>
              <VoiceNoteButton
                onText={(t) => setUserContext(userContext ? `${userContext.trim()} ${t}` : t)}
                onError={onVoiceError}
              />
            </View>
            <TextInput
              style={[sh.inputField, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
              value={userContext}
              onChangeText={setUserContext}
              placeholder="a few sentences in your own words. speak or type."
              placeholderTextColor={c.faint}
              multiline
            />
            <Text variant="monoSmall" style={{ color: c.faint, marginTop: Spacing[2] }}>
              {contextThin
                ? 'we build the connections and insight from this.'
                : 'optional. helps when the excerpt is short.'}
            </Text>
          </View>
        )}
        {!!error && (
          <Text variant="monoSmall" color="danger" style={{ marginTop: Spacing[3] }}>{error}</Text>
        )}
        <Divider c={c} />
        <View style={sh.actions}>
          {/* Locked while guided, same as StepOne's close — the walkthrough
              expects commit next, not a return to the form. */}
          <Pressable onPress={onBack} disabled={commitTarget.isActive} style={[sh.secondaryBtn, { opacity: commitTarget.isActive ? 0.35 : 1 }]}>
            <Text variant="monoSmall" style={{ color: c.muted }}>← back</Text>
          </Pressable>
          <Pressable
            onPress={() => { onCommit(); commitTarget.press(); }}
            disabled={commitDisabled}
            style={[sh.primaryBtn, { backgroundColor: c.text, opacity: commitDisabled ? 0.55 : 1 }]}
          >
            <Text variant="monoSmall" style={{ color: c.background }}>
              {busy ? 'saving...' : 'commit →'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const sh = StyleSheet.create({
  divider: { height: 1, marginVertical: Spacing[5] },
  heading: { marginTop: Spacing[6], marginBottom: Spacing[2] },
  sub: { opacity: 0.7 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginBottom: Spacing[4] },
  modeChip: { paddingVertical: Spacing[2], paddingHorizontal: Spacing[3], borderRadius: Radius.xs, borderWidth: 1 },
  thumb: { width: '100%', height: 180, borderRadius: Radius.xs, marginBottom: Spacing[2] },
  inputBox: { borderWidth: 1, borderRadius: Radius.xs, padding: Spacing[4], marginTop: Spacing[2] },
  inputLabel: { marginBottom: Spacing[2] },
  preflightRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: Spacing[3] },
  contextHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputField: { minHeight: 72, paddingVertical: Spacing[1] },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  secondaryBtn: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[2] },
  primaryBtn: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[5], borderRadius: Radius.xs },
  clipChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    marginTop: Spacing[3],
  },
});

// ── Toolbar ────────────────────────────────────────────────────────

function Toolbar({
  toolMode, setToolMode, onRecenter, showRecenter, c,
}: {
  toolMode: ToolMode;
  setToolMode: (m: ToolMode) => void;
  onRecenter?: () => void;
  showRecenter?: boolean;
  c: AppThemeColors;
}) {
  const iconColor = (active: boolean) => (active ? c.text : c.muted);
  const tools: { id: Exclude<ToolMode, 'default'>; label: string; Icon: LucideIcon }[] = [
    { id: 'discover', label: 'Discover connections', Icon: Crosshair },
    { id: 'search', label: 'Find on map', Icon: Search },
  ];

  // Walkthrough spotlights for the individual buttons, not the whole pill.
  const recenterTarget = useTutorialTarget(TUTORIAL_TARGET.atlasRecenter);
  const discoverTarget = useTutorialTarget(TUTORIAL_TARGET.atlasDiscover);

  const recenterVisible = !!onRecenter && showRecenter !== false;

  return (
    <View style={[tb.pill, { backgroundColor: 'rgba(10,10,10,0.72)', borderColor: 'rgba(255,255,255,0.12)' }]}>
      {recenterVisible && (
        <>
          <Pressable
            ref={recenterTarget.ref}
            onLayout={recenterTarget.onLayout}
            onPress={onRecenter}
            style={tb.btn}
            accessibilityLabel="Fit all points in view"
            accessibilityRole="button"
          >
            <Svg width={17} height={17} viewBox="0 0 18 18">
              <Rect x={1.5} y={1.5} width={15} height={15} fill="none" stroke={c.muted} strokeWidth={1} strokeDasharray="3 2.5" />
              <Circle cx={9} cy={9} r={1.5} fill={c.muted} />
              <Line x1={9} y1={4} x2={9} y2={14} stroke={c.muted} strokeWidth={0.7} strokeDasharray="1.5 1.5" />
              <Line x1={4} y1={9} x2={14} y2={9} stroke={c.muted} strokeWidth={0.7} strokeDasharray="1.5 1.5" />
            </Svg>
          </Pressable>
          <View style={[tb.sep, { backgroundColor: 'rgba(255,255,255,0.08)' }]} />
        </>
      )}
      {tools.map((tool, i) => {
        const active = toolMode === tool.id;
        const isDiscover = tool.id === 'discover';
        return (
          <React.Fragment key={tool.id}>
            {i > 0 && <View style={[tb.sep, { backgroundColor: 'rgba(255,255,255,0.08)' }]} />}
            <Pressable
              ref={isDiscover ? discoverTarget.ref : undefined}
              onLayout={isDiscover ? discoverTarget.onLayout : undefined}
              onPress={() => setToolMode(active ? 'default' : tool.id)}
              style={[tb.btn, active && { backgroundColor: 'rgba(255,255,255,0.08)' }]}
              accessibilityLabel={tool.label}
              accessibilityRole="button"
            >
              <tool.Icon size={17} color={iconColor(active)} strokeWidth={1.5} />
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const tb = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: { width: 1, height: 18 },
});

// ── Info panel (top-right map summary) ────────────────────────────

interface ExcitingLine {
  text: string;
  route: string;
}

function InfoPanel({
  top, collapsed, onToggle, pointCount, totalPointCount, fieldCount, connectionCount, tensionCount, exciting, onNavigate,
}: {
  top: number;
  collapsed: boolean;
  onToggle: () => void;
  pointCount: number;
  /** Matching captures server-side; > pointCount means the map is truncated. */
  totalPointCount: number;
  fieldCount: number;
  connectionCount: number;
  tensionCount: number;
  exciting: ExcitingLine | null;
  onNavigate: (route: string) => void;
}) {
  // At most five lines. Topics are intentionally omitted here (they're
  // surfaced on Archive and elsewhere) to keep this compact. Lines are
  // ordered longest-first so the right-aligned block tapers cleanly.
  const entries: { key: string; label: string; node: React.ReactNode }[] = [];

  // Never pretend the visible window is everything: past the fetch limit the
  // map shows the most recent captures, and this line says so.
  const pointsLabel = totalPointCount > pointCount
    ? `latest ${pointCount} of ${totalPointCount} points`
    : `${pointCount} ${pointCount === 1 ? 'point' : 'points'}`;
  entries.push({
    key: 'points',
    label: pointsLabel,
    node: (
      <Text key="points" variant="monoSmall" style={infoPanelStyles.line}>{pointsLabel}</Text>
    ),
  });
  if (fieldCount > 0) {
    const label = `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`;
    entries.push({
      key: 'fields',
      label,
      node: (
        <Text key="fields" variant="monoSmall" style={infoPanelStyles.line}>{label}</Text>
      ),
    });
  }
  if (connectionCount > 0) {
    const label = `${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}`;
    entries.push({
      key: 'connections',
      label,
      node: (
        <Text key="connections" variant="monoSmall" style={infoPanelStyles.line}>{label}</Text>
      ),
    });
  }
  if (tensionCount > 0) {
    const label = `${tensionCount} ${tensionCount === 1 ? 'tension' : 'tensions'} →`;
    entries.push({
      key: 'tensions',
      label,
      node: (
        <Pressable key="tensions" onPress={() => onNavigate('/(tabs)/mind')} hitSlop={6} pointerEvents="auto">
          <Text variant="monoSmall" style={infoPanelStyles.exciting}>{label}</Text>
        </Pressable>
      ),
    });
  }
  if (exciting) {
    entries.push({
      key: 'exciting',
      label: exciting.text,
      node: (
        <Pressable key="exciting" onPress={() => onNavigate(exciting.route)} hitSlop={6} pointerEvents="auto">
          <Text variant="monoSmall" style={infoPanelStyles.exciting} numberOfLines={1}>{exciting.text}</Text>
        </Pressable>
      ),
    });
  }

  const items = entries
    .sort((a, b) => b.label.length - a.label.length)
    .map((e) => e.node);

  return (
    <View style={[infoPanelStyles.wrap, { top }]} pointerEvents="box-none">
      {!collapsed && <View style={infoPanelStyles.lines}>{items.slice(0, 5)}</View>}
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        style={infoPanelStyles.toggle}
        pointerEvents="auto"
        accessibilityLabel={collapsed ? 'Show map summary' : 'Hide map summary'}
        accessibilityRole="button"
      >
        {collapsed
          ? <ChevronDown size={16} color="rgba(236,236,236,0.4)" strokeWidth={1.5} />
          : <ChevronUp size={16} color="rgba(236,236,236,0.4)" strokeWidth={1.5} />}
      </Pressable>
    </View>
  );
}

const infoPanelStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing[6],
    alignItems: 'flex-end',
    maxWidth: 210,
  },
  lines: {
    alignItems: 'flex-end',
  },
  toggle: {
    marginTop: 2,
    padding: 2,
  },
  line: {
    color: 'rgba(236,236,236,0.28)',
    marginBottom: 4,
  },
  exciting: {
    color: 'rgba(236,236,236,0.5)',
    marginBottom: 4,
  },
});

// ── Timeline scrubber (temporal lens) ─────────────────────────────

interface TimelineScrubberProps {
  startMs: number;
  endMs: number;
  pct: number;
  onChange: (p: number) => void;
  top: number;
  railH: number;
}

// Vertical rail: pinned to the right edge, clear of the centered FAB. Top =
// account created, bottom = the present; drag (or tap) anywhere on the rail to
// travel through time. The thumb is clamped to the track so it never overflows.
// Position/height are computed by the caller from the real header and tab-bar
// bounds (see MapScreen) and passed in as `top`/`railH`.
const RAIL_TRACK_W = 40;
const RAIL_THUMB = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

type TimelineTick = { pct: number; label: string; labelled: boolean };

// Evenly spaced round-date marks along the rail. Picks the smallest round
// step (1/2/3/7/14 days, then 1/2/3/6/12 calendar months) that fits within
// MAX_TICKS marks, anchored to midnight / the 1st of the month — so ticks are
// uniformly spaced AND land on dates a person would actually say.
const TIMELINE_MAX_TICKS = 7;

function buildTimelineTicks(startMs: number, endMs: number): { ticks: TimelineTick[] } {
  const span = Math.max(endMs - startMs, 1);
  const pctOf = (ts: number) => (ts - startMs) / span;
  const fmtDay = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtMonth = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

  const ticks: TimelineTick[] = [];

  const stepDays = [1, 2, 3, 7, 14].find((d) => span / (d * DAY_MS) <= TIMELINE_MAX_TICKS);
  if (stepDays) {
    // First midnight at or after the start, then a fixed day stride.
    const d = new Date(startMs); d.setHours(0, 0, 0, 0);
    if (d.getTime() < startMs) d.setDate(d.getDate() + 1);
    for (let t = d.getTime(); t <= endMs; t += stepDays * DAY_MS) {
      ticks.push({ pct: pctOf(t), label: fmtDay(t), labelled: true });
    }
  } else {
    const stepMonths = [1, 2, 3, 6, 12].find((m) => span / (m * 30.44 * DAY_MS) <= TIMELINE_MAX_TICKS) ?? 12;
    // First 1st-of-month at or after the start, then a fixed month stride.
    const d = new Date(startMs); d.setDate(1); d.setHours(0, 0, 0, 0);
    while (d.getTime() < startMs) d.setMonth(d.getMonth() + 1);
    for (; d.getTime() <= endMs; d.setMonth(d.getMonth() + stepMonths)) {
      ticks.push({ pct: pctOf(d.getTime()), label: fmtMonth(d.getTime()), labelled: true });
    }
  }

  // The endpoints carry their own fixed labels (account created / today) —
  // unlabel marks that would crowd them.
  for (const tk of ticks) {
    if (tk.pct < 0.05 || tk.pct > 0.95) tk.labelled = false;
  }

  return { ticks };
}

function TimelineScrubber({ startMs, endMs, pct, onChange, top, railH }: TimelineScrubberProps) {
  // The pan responder closure is created once (via useRef below), so it must
  // read the rail height through a ref rather than the closed-over prop —
  // otherwise a post-mount header measurement would leave drag math stale.
  const railHRef = useRef(railH);
  railHRef.current = railH;

  const { ticks } = useMemo(() => buildTimelineTicks(startMs, endMs), [startMs, endMs]);

  const cutoffDate = useMemo(
    () => new Date(startMs + (endMs - startMs) * pct),
    [startMs, endMs, pct],
  );
  const dateLabel = cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const startLabel = new Date(startMs).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
  });
  const nowLabel = new Date(endMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // The drag is anchored to the pct captured at touch-down. Deriving each
  // move from the CURRENT pct plus the gesture's cumulative dy double-counted
  // every previous move — the thumb accelerated away from the finger, which
  // was the scrubber's characteristic glitch.
  const grantPctRef = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Tap-to-jump: land the thumb wherever the rail is touched.
      onPanResponderGrant: (evt) => {
        const y = evt.nativeEvent.locationY;
        const newPct = Math.max(0, Math.min(1, y / railHRef.current));
        grantPctRef.current = newPct;
        onChange(newPct);
      },
      // Scrub: the thumb follows the finger from where the touch began.
      onPanResponderMove: (evt, gs) => {
        const newPct = Math.max(0, Math.min(1, grantPctRef.current + gs.dy / railHRef.current));
        onChange(newPct);
      },
    }),
  ).current;

  // Clamp so the thumb (and the readout that tracks it) stay on the rail.
  const thumbY = Math.max(0, Math.min(railH, pct * railH));
  const labelTop = Math.max(0, Math.min(railH - 12, thumbY - 6));
  // The fixed end label already shows the current date once scrubbed all the
  // way down — hide the moving readout there so it isn't shown twice.
  const showReadout = pct < 0.985;

  return (
    <View style={[tls.wrap, { top, height: railH + 40 }]} pointerEvents="box-none">
      <Text style={[tls.label, { color: 'rgba(236,236,236,0.35)' }]}>date</Text>
      <View style={[tls.trackWrap, { height: railH }]} {...pan.panHandlers}>
        {/* Track */}
        <View style={[tls.track, { backgroundColor: 'rgba(255,255,255,0.08)' }]} />
        {/* Filled portion (created → cutoff) */}
        <View style={[tls.fill, { height: thumbY, backgroundColor: 'rgba(255,255,255,0.22)' }]} />
        {/* Incremental date ticks */}
        {ticks.map((tk, i) => (
          <React.Fragment key={i}>
            <View
              style={[
                tls.tick,
                {
                  top: tk.pct * railH - 1,
                  width: tk.labelled ? 9 : 5,
                  left: (RAIL_TRACK_W - (tk.labelled ? 9 : 5)) / 2,
                  backgroundColor: tk.labelled ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.15)',
                },
              ]}
            />
            {tk.labelled && (
              <Text
                style={[tls.tickLabel, { top: tk.pct * railH - 6, color: 'rgba(236,236,236,0.3)' }]}
                numberOfLines={1}
              >
                {tk.label}
              </Text>
            )}
          </React.Fragment>
        ))}
        {/* Endpoint labels: account created (top) and the current date (bottom) */}
        <Text style={[tls.endLabel, { top: -3 }]} numberOfLines={1}>{startLabel}</Text>
        <Text style={[tls.endLabel, { top: railH - 9 }]} numberOfLines={1}>{nowLabel}</Text>
        {/* Thumb */}
        <View style={[tls.thumb, { top: thumbY - RAIL_THUMB / 2, backgroundColor: MAP_NODE }]} />
        {/* Cutoff-date readout — dark pill so it stays legible over tick labels */}
        {showReadout && (
          <View style={[tls.datePill, { top: labelTop - 3 }]} pointerEvents="none">
            <Text style={tls.dateLabelText} numberOfLines={1}>{dateLabel}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const tls = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing[3],
    alignItems: 'center',
  },
  label: {
    fontFamily: FontFamily.mono,
    fontSize: 8,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: Spacing[2],
  },
  trackWrap: {
    width: RAIL_TRACK_W,
    alignItems: 'center',
  },
  track: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
  },
  fill: {
    position: 'absolute',
    top: 0,
    width: 2,
    borderRadius: 1,
  },
  tick: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
  },
  tickLabel: {
    position: 'absolute',
    right: RAIL_TRACK_W - 4,
    fontFamily: FontFamily.mono,
    fontSize: 8,
    letterSpacing: 0.3,
    width: 60,
    textAlign: 'right',
  },
  endLabel: {
    position: 'absolute',
    right: RAIL_TRACK_W - 4,
    fontFamily: FontFamily.mono,
    fontSize: 8.5,
    letterSpacing: 0.3,
    width: 60,
    textAlign: 'right',
    color: 'rgba(236,236,236,0.5)',
  },
  thumb: {
    position: 'absolute',
    width: RAIL_THUMB,
    height: RAIL_THUMB,
    borderRadius: RAIL_THUMB / 2,
  },
  datePill: {
    position: 'absolute',
    right: RAIL_TRACK_W - 2,
    backgroundColor: 'rgba(6,6,6,0.9)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dateLabelText: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: 'rgba(236,236,236,0.75)',
  },
});

// ── Center focus button ────────────────────────────────────────────

function CenterFocusButton({ onPress, color, borderColor }: {
  onPress: () => void;
  color: string;
  borderColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.centerBtn, { borderColor }]}
      accessibilityLabel="Fit all points in view"
      accessibilityRole="button"
    >
      <Svg width={16} height={16} viewBox="0 0 18 18">
        <Rect x={1.5} y={1.5} width={15} height={15} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 2.5" />
        <Circle cx={9} cy={9} r={1.5} fill={color} />
        <Line x1={9} y1={4} x2={9} y2={14} stroke={color} strokeWidth={0.7} strokeDasharray="1.5 1.5" />
        <Line x1={4} y1={9} x2={14} y2={9} stroke={color} strokeWidth={0.7} strokeDasharray="1.5 1.5" />
      </Svg>
    </Pressable>
  );
}

// ── Main screen ────────────────────────────────────────────────────

export default function MapScreen() {
  const c = useThemeColors();
  const { setMode: setThemeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { start: startTutorial, active: tutorialActive, notifyTargetPressed } = useTutorial();
  const fabTarget = useTutorialTarget(TUTORIAL_TARGET.captureFab);
  // The node-management steps target the walkthrough's own demo node/delete
  // control specifically, not any node — reused below by id match.
  const nodeTarget = useTutorialTarget(TUTORIAL_TARGET.nodeTap);
  const deleteTarget = useTutorialTarget(TUTORIAL_TARGET.nodeDelete);
  // "Look at this" spotlight step on the lens picker. (The toolbar buttons
  // register their own targets inside Toolbar.)
  const lensTarget = useTutorialTarget(TUTORIAL_TARGET.atlasLenses);
  const [infoVisible, setInfoVisible] = useState(false);
  // Measured header height, so the timeline rail can center itself in the
  // actual gap below the header instead of guessing. Falls back to a sane
  // estimate until the first layout pass reports the real value.
  const [headerH, setHeaderH] = useState(0);

  const mapBg = c.mapBackground;
  const isDarkMode = c.mapBackground === '#060606';

  const { data: graphData, loading: graphLoading, refetch: refetchGraph } = useApiQuery(
    () => api.memory.graph({ limit: 80 }),
    [],
    { cacheKey: 'memory.graph' },
  );

  // ── Focus mode / topic sub-maps ───────────────────────────────
  // Focusing a topic opens that topic's COMPLETE map — every capture in it
  // (up to the server cap), not just the ones that happen to fall inside the
  // recent-80 overview fetch. Hand-rolled rather than useApiQuery: the fetch
  // is keyed on a changing topicId, and the interim state must fall back to
  // the dimmed overview, never to a previously focused topic's data.
  const [focusedTopicId, setFocusedTopicId] = useState<string | null>(null);
  const [focusedGraph, setFocusedGraph] = useState<{ topicId: string; data: MemoryGraphResponse } | null>(null);
  const focusedSeq = useRef(0);
  const fetchFocusedGraph = useCallback((topicId: string) => {
    const seq = ++focusedSeq.current;
    api.memory
      .graph({ topicId, limit: 200 })
      .then((data) => {
        if (focusedSeq.current === seq) setFocusedGraph({ topicId, data });
      })
      .catch(() => {
        // Leave the dimmed overview in place — still a usable focus view.
      });
  }, []);
  useEffect(() => {
    if (!focusedTopicId) {
      focusedSeq.current += 1;
      setFocusedGraph(null);
      return;
    }
    fetchFocusedGraph(focusedTopicId);
  }, [focusedTopicId, fetchFocusedGraph]);
  const activeFocusGraph =
    focusedTopicId && focusedGraph?.topicId === focusedTopicId ? focusedGraph.data : null;
  // Drives the DIM treatment only: once the sub-map is live every visible
  // node belongs to the topic, so nothing should be dimmed.
  const focusDimTopicId = activeFocusGraph ? null : focusedTopicId;

  // Account creation date anchors the temporal timeline's start.
  const { data: profileData } = useApiQuery(() => api.profile.me(), [], { cacheKey: 'profile.me' });
  const accountCreatedMs = useMemo(() => {
    const created = profileData?.profile.createdAt;
    return created ? new Date(created).getTime() : null;
  }, [profileData]);

  // Info panel: independent, non-blocking fetches — each line appears as
  // soon as its own data resolves, without gating on the others.
  const { data: intelligenceData, refetch: refetchIntelligence } = useApiQuery(() => api.memory.intelligence(), [], { cacheKey: 'memory.intelligence' });
  const { data: trendsData, refetch: refetchTrends } = useApiQuery(() => api.memory.trends({ window: 'week' }), [], { cacheKey: 'memory.trends:week' });
  const { data: pulseData, refetch: refetchPulse } = useApiQuery(() => api.social.pulse(), [], { cacheKey: 'social.pulse' });

  // Revalidate every map surface at once. The info panel's counts (tensions,
  // rising themes, connections) derive from these side-fetches, so refetching
  // only the graph after a capture/delete left the panel showing pre-mutation
  // numbers until a full app restart.
  // Read through a ref so refetchMapData keeps a stable identity — it feeds
  // useFocusEffect, and a focus toggle must not re-trigger the whole
  // revalidation fan-out.
  const focusedTopicIdRef = useRef<string | null>(null);
  useEffect(() => { focusedTopicIdRef.current = focusedTopicId; }, [focusedTopicId]);

  const refetchMapData = useCallback(() => {
    void refetchGraph();
    if (focusedTopicIdRef.current) fetchFocusedGraph(focusedTopicIdRef.current);
    void refetchIntelligence();
    void refetchTrends();
    void refetchPulse();
  }, [refetchGraph, fetchFocusedGraph, refetchIntelligence, refetchTrends, refetchPulse]);

  useFocusEffect(refetchMapData);

  // The walkthrough's practice capture. Local-only — it is never sent to the
  // server, so the guided flow makes no API/AI calls and behaves identically
  // every time. Injected into the rendered node list; removed by the delete
  // step, and purged below whenever the walkthrough ends.
  const [demoNode, setDemoNode] = useState<GraphNode | null>(null);
  // Also catches a simulated save that lands after an early exit — the node
  // arriving re-runs this effect, so it can never outlive the walkthrough.
  useEffect(() => {
    if (!tutorialActive && demoNode) setDemoNode(null);
  }, [tutorialActive, demoNode]);

  const serverNodes = activeFocusGraph?.nodes ?? graphData?.nodes;
  const nodes = useMemo<GraphNode[]>(() => {
    const base = serverNodes ?? [];
    return demoNode ? [...base, demoNode] : base;
  }, [serverNodes, demoNode]);
  const edges = activeFocusGraph?.edges ?? graphData?.edges ?? [];
  const clusters = activeFocusGraph?.clusters ?? graphData?.clusters ?? [];
  // Total matching captures server-side (may exceed what's fetched/rendered).
  // Falls back to the rendered count for cached pre-totalCount responses.
  const totalCaptureCount = activeFocusGraph?.totalCount ?? graphData?.totalCount ?? 0;

  const fieldCount = useMemo(() => {
    const fieldIds = new Set<string>();
    for (const n of nodes) {
      for (const t of n.topics) {
        if (t.kind === 'general') fieldIds.add(t.topicId);
      }
    }
    return fieldIds.size;
  }, [nodes]);

  const tensionCount = intelligenceData?.contradictionCards.length ?? 0;

  const excitingLine = useMemo((): ExcitingLine | null => {
    const friendWithRecent = pulseData?.friends.find((f) => {
      const latest = f.latest[0];
      return latest && Date.now() - new Date(latest.capturedAt).getTime() < DAY_MS;
    });
    if (friendWithRecent) {
      return { text: `${friendWithRecent.user.displayName} added something →`, route: '/(tabs)/pulse' };
    }
    // The server ranks this by per-day rate, so a topic that just woke up beats
    // the one that's merely biggest. Ranking `shifts` here instead re-introduced
    // that bias — the largest topic stayed "rising" no matter what was captured.
    const risingTheme = trendsData?.rising;
    if (risingTheme) {
      // Route to the topic's archive (a real screen) — there is no trends tab.
      return { text: `${risingTheme.name} rising →`, route: `/archive/${risingTheme.topicId}` };
    }
    return null;
  }, [pulseData, trendsData]);

  // ── Lens mode ──────────────────────────────────────────────────
  const [lensMode, setLensMode] = useState<LensMode>('semantic');
  // True while nodes are easing between layouts, so per-lens labels can stay
  // hidden until the map has settled (otherwise they float over moving nodes).
  const [lensTransitioning, setLensTransitioning] = useState(false);

  // ── Viewport: pan + zoom ──────────────────────────────────────
  // Two-tier camera. The COMMITTED camera (vbPos/zoom React state) is what the
  // SVG world and its touch targets are rendered against; it changes only when
  // a gesture or camera animation settles. The LIVE camera (refs) moves every
  // frame, expressed as a view transform on the map wrapper — one native style
  // update per frame, zero React re-renders. Re-rendering the whole SVG tree
  // per gesture frame is what made the map chunky as nodes accumulated.
  const savedVB = useRef({ x: INIT_VB_X, y: INIT_VB_Y });
  const [vbPos, setVbPos] = useState({ x: INIT_VB_X, y: INIT_VB_Y });

  const savedZoom = useRef(0.4);
  const [zoom, setZoom] = useState(0.4);

  // The camera as of the last *settled* gesture/animation. The touch layer is
  // built against this, not the committed camera: hit targets are invisible
  // and unreachable mid-gesture (the PanResponder owns the touch), so moving
  // ~one native view per node on every mid-gesture re-commit bought nothing.
  // They realign on settle, which is the only time they can be tapped.
  const [settledCam, setSettledCam] = useState({ x: INIT_VB_X, y: INIT_VB_Y, zoom: 0.4 });

  const committedCam = useRef({ x: INIT_VB_X, y: INIT_VB_Y, zoom: 0.4 });
  const liveCam = useRef({ x: INIT_VB_X, y: INIT_VB_Y, zoom: 0.4 });
  const liveTx = useRef(new RNAnimated.Value(0)).current;
  const liveTy = useRef(new RNAnimated.Value(0)).current;
  const liveScale = useRef(new RNAnimated.Value(1)).current;

  // RN scales about the transformed view's ACTUAL centre — and inside the tab
  // navigator the map container is shorter than the window (tab bar), so the
  // centre compensation must use the measured size, not SW/SH. Using SH/2
  // here made every pinch drift vertically mid-gesture and then visibly
  // "correct" itself on commit.
  const wrapperSize = useRef({ w: SW, h: SH });

  // Express the live camera as a transform of the committed rendering.
  // screen = (world − live)·z_live must equal scale-about-view-centre (RN's
  // transform origin) plus translate of the committed rendering, which solves
  // to k = z_live/z_committed, t = (committed − live)·z_live, with the usual
  // centre-origin compensation C·(k−1).
  const applyLiveCamera = useCallback((x: number, y: number, z: number) => {
    liveCam.current = { x, y, zoom: z };
    const c = committedCam.current;
    const k = z / c.zoom;
    liveTx.setValue((c.x - x) * z + (wrapperSize.current.w / 2) * (k - 1));
    liveTy.setValue((c.y - y) * z + (wrapperSize.current.h / 2) * (k - 1));
    liveScale.setValue(k);
  }, [liveTx, liveTy, liveScale]);

  // Smoothed live-camera velocity in screen px/frame, used to aim the raster.
  const camVel = useRef({ x: 0, y: 0 });
  const lastLive = useRef({ x: INIT_VB_X, y: INIT_VB_Y, zoom: 0.4 });

  const resetVelocity = useCallback(() => {
    camVel.current = { x: 0, y: 0 };
    lastLive.current = { ...liveCam.current };
  }, []);

  // Re-render the world with its raster anchored at (ax, ay) — not necessarily
  // the live camera; see maybeRecommit. Touches only the rendering tier — NOT
  // savedVB/savedZoom, which are the gesture's baseline. A pan derives its
  // position from that baseline minus PanResponder's cumulative `gs.dx`, so
  // moving the baseline mid-gesture would re-apply the whole accumulated delta
  // on the next frame and lurch the map sideways.
  const commitRender = useCallback((ax: number, ay: number, z: number) => {
    committedCam.current = { x: ax, y: ay, zoom: z };
    setVbPos({ x: ax, y: ay });
    setZoom(z);
  }, []);

  // Commit at the end of a gesture/animation: re-render AND resync the
  // baseline, so the next gesture starts from where the camera actually is.
  // Settles the raster on the camera itself — there is no motion to lead.
  const commitCamera = useCallback(() => {
    const { x, y, zoom: z } = liveCam.current;
    savedVB.current = { x, y };
    savedZoom.current = z;
    commitRender(x, y, z);
    setSettledCam({ x, y, zoom: z });
    resetVelocity();
  }, [commitRender, resetVelocity]);

  // Coverage checkpoint — the piece that keeps "uncharted" territory painted.
  //
  // The committed world occupies [−MARGIN, screen + MARGIN] in wrapper space.
  // The wrapper scales it by k about its centre and translates it by t (the
  // very transform applyLiveCamera computes), so project its edges to the
  // screen and measure how much painted map still runs past each one. When
  // that slack falls below RECOMMIT_SLACK, re-render around the live camera.
  //
  // Note both scale and the centre-origin compensation matter here: an
  // off-centre pinch moves t even when the camera's x/y barely change, so a
  // threshold on camera drift alone silently uncovers an edge.
  //
  // Every loop that drives applyLiveCamera — pinch, pan, momentum, animated
  // fly-to — calls this, so no path can outrun the rendered map.
  const maybeRecommit = useCallback((x: number, y: number, z: number) => {
    const c = committedCam.current;
    const k = z / c.zoom;

    // Track how fast the camera is moving across the screen, smoothed so a
    // single jittery frame can't swing the aim.
    const prev = lastLive.current;
    const zooming = z !== prev.zoom;
    camVel.current = {
      x: camVel.current.x * (1 - VEL_EMA) + (x - prev.x) * z * VEL_EMA,
      y: camVel.current.y * (1 - VEL_EMA) + (y - prev.y) * z * VEL_EMA,
    };
    lastLive.current = { x, y, zoom: z };

    // Aim the new raster ahead of the camera. Skip while pinching: the motion
    // there is scale, not travel, and leading on it only shifts coverage off
    // the centre the user is zooming into.
    const commitAimed = () => {
      const { x: vx, y: vy } = camVel.current;
      const speed = Math.hypot(vx, vy);
      if (zooming || speed < 1) { commitRender(x, y, z); return; }
      const lead = Math.min(RECOMMIT_LEAD_MAX, speed * LEAD_FRAMES) / z;
      commitRender(x + (lead * vx) / speed, y + (lead * vy) / speed, z);
    };

    if (k > RECOMMIT_ZOOM_IN) { commitAimed(); return; }

    const { w: vw, h: vh } = wrapperSize.current;
    const cx = vw / 2;
    const cy = vh / 2;
    const tx = (c.x - x) * z + cx * (k - 1);
    const ty = (c.y - y) * z + cy * (k - 1);

    const left = -(cx + tx + k * (-MARGIN_X - cx));
    const right = (cx + tx + k * (SW + MARGIN_X - cx)) - vw;
    const top = -(cy + ty + k * (-MARGIN_Y - cy));
    const bottom = (cy + ty + k * (SH + MARGIN_Y - cy)) - vh;

    if (Math.min(left, right, top, bottom) < RECOMMIT_SLACK) commitAimed();
  }, [commitRender]);

  // Move both tiers at once (programmatic, non-animated camera jumps). These
  // land settled, so the touch layer follows immediately.
  const setCamera = useCallback((x: number, y: number, z: number) => {
    savedVB.current = { x, y };
    savedZoom.current = z;
    liveCam.current = { x, y, zoom: z };
    committedCam.current = { x, y, zoom: z };
    setVbPos({ x, y });
    setZoom(z);
    setSettledCam({ x, y, zoom: z });
    camVel.current = { x: 0, y: 0 };
    lastLive.current = { x, y, zoom: z };
  }, []);

  // After every render the world reflects the committed camera, so re-derive
  // the wrapper transform (identity once settled; still correct if an
  // unrelated re-render lands mid-gesture).
  useLayoutEffect(() => {
    applyLiveCamera(liveCam.current.x, liveCam.current.y, liveCam.current.zoom);
  });

  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  const resetView = useCallback(() => {
    setCamera(INIT_VB_X, INIT_VB_Y, 0.4);
  }, [setCamera]);

  // Compute all 3 layouts upfront
  const semanticPos = useMemo(
    () =>
      applyLayoutOffset(
        layoutSemanticFromServer(nodes, LAYOUT_W, LAYOUT_H) ??
          layoutGraph(nodes, clusters, edges, LAYOUT_W, LAYOUT_H),
      ),
    [nodes, clusters, edges],
  );
  // Time lens reuses the semantic layout: its actual "time" meaning is
  // carried entirely by the timeline scrubber dimming nodes past the cutoff
  // (see getNodeOpacity), not by spatial position — so switching semantic
  // ↔ time never moves a single node or the camera.
  const temporalPos = semanticPos;

  // Rendered positions (animated between lenses)
  const renderPosRef = useRef<PositionMap>({});
  const [renderPos, setRenderPos] = useState<PositionMap>({});
  const lensAnimCancelRef = useRef<(() => void) | null>(null);

  // Stable identity of the node set AND their server coordinates — changes on
  // add, remove, or when the server refines the layout.
  const nodeIdsKey = useMemo(
    () => nodes.map((n) => `${n.id}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).sort().join(','),
    [nodes],
  );

  // React to layout changes. Server coordinates are persisted, so a plain
  // refetch (returning to this tab) is a no-op and nothing drifts. When a new
  // capture is added the server re-relaxes the map globally: the new node
  // slides in from its nearest existing neighbour, and existing nodes ease
  // from their previous spots to their (usually barely different) refined ones.
  useEffect(() => {
    if (nodes.length === 0) {
      if (lensAnimCancelRef.current) { lensAnimCancelRef.current(); lensAnimCancelRef.current = null; }
      renderPosRef.current = {};
      setRenderPos({});
      return;
    }

    const targetPos = lensMode === 'semantic' ? semanticPos : temporalPos;

    const prev = renderPosRef.current;
    const prevIds = Object.keys(prev);
    const newIds = Object.keys(targetPos).filter((id) => !(id in prev));
    const firstLoad = prevIds.length === 0;

    if (lensAnimCancelRef.current) { lensAnimCancelRef.current(); lensAnimCancelRef.current = null; }

    // First load, non-semantic lens, or a wholesale change → snap directly.
    if (firstLoad || lensMode !== 'semantic' ||
        newIds.length === Object.keys(targetPos).length) {
      renderPosRef.current = targetPos;
      setRenderPos(targetPos);
      return;
    }

    // Seed each new node at its nearest existing neighbour, then ease to target.
    const starts: PositionMap = {};
    for (const id of newIds) {
      const target = targetPos[id]!;
      let best = target;
      let bestD = Infinity;
      for (const eid of prevIds) {
        const p = targetPos[eid];
        if (!p) continue;
        const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      starts[id] = best;
    }
    // Existing nodes ease from where they currently sit to their refined spot.
    for (const id of prevIds) {
      if (targetPos[id]) starts[id] = prev[id]!;
    }

    const startTime = Date.now();
    const duration = 600;
    let cancelled = false;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - startTime) / duration);
      const eased = easeOut(t);
      const newPos: PositionMap = {};
      for (const [id, target] of Object.entries(targetPos)) {
        const from = starts[id];
        newPos[id] = from
          ? { x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased }
          : target;
      }
      renderPosRef.current = newPos;
      setRenderPos(newPos);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    lensAnimCancelRef.current = () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIdsKey]);

  const handleLensChange = useCallback((newLens: LensMode) => {
    if (newLens === lensMode) return;

    if (lensAnimCancelRef.current) {
      lensAnimCancelRef.current();
      lensAnimCancelRef.current = null;
    }

    const targetPos = newLens === 'semantic' ? semanticPos : temporalPos;

    setLensMode(newLens);

    if (Object.keys(renderPosRef.current).length === 0) {
      renderPosRef.current = targetPos;
      setRenderPos(targetPos);
      const fit = computeCameraFit(nodes, targetPos);
      if (fit) setCamera(fit.x, fit.y, fit.zoom);
      return;
    }

    const fromPos: PositionMap = { ...renderPosRef.current };
    const startTime = Date.now();
    const duration = 720;
    let cancelled = false;

    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    setLensTransitioning(true);

    const tick = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - startTime) / duration);
      const eased = easeInOutCubic(t);
      const newPos: PositionMap = {};
      for (const [id, target] of Object.entries(targetPos)) {
        const from = fromPos[id] ?? target;
        newPos[id] = {
          x: from.x + (target.x - from.x) * eased,
          y: from.y + (target.y - from.y) * eased,
        };
      }
      renderPosRef.current = newPos;
      setRenderPos(newPos);

      // Derive the camera from these same in-flight positions every frame
      // instead of flying it toward a separately-eased target — see
      // computeCameraFit for why an independent camera tween causes overshoot.
      // The lens tick re-renders per frame anyway (node positions are React
      // state), so committing the camera per frame here costs nothing extra.
      const fit = computeCameraFit(nodes, newPos);
      if (fit) setCamera(fit.x, fit.y, fit.zoom);

      if (t < 1) requestAnimationFrame(tick);
      else setLensTransitioning(false);
    };

    requestAnimationFrame(tick);
    lensAnimCancelRef.current = () => { cancelled = true; setLensTransitioning(false); };
  }, [lensMode, semanticPos, temporalPos, nodes, setCamera]);

  // Use renderPos for display, fall back to semanticPos on first render
  const pos = Object.keys(renderPos).length > 0 ? renderPos : semanticPos;

  // ── Cluster label positions (semantic only for labels) ─────────
  // Anchor each region label at the centroid of its members' semantic
  // positions, so halos sit over the actual nodes in the embedding layout.
  const clusterLabels = useMemo(
    () =>
      clusters
        .filter((cl) => cl.count >= MAJOR_CLUSTER_MIN)
        .map((cl) => {
          const pts = cl.itemIds
            .map((id) => semanticPos[id])
            .filter((p): p is { x: number; y: number } => Boolean(p));
          if (pts.length === 0) return null;
          const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
          return { ...cl, x, y };
        })
        .filter((cl): cl is typeof clusters[number] & { x: number; y: number } => cl !== null),
    [clusters, semanticPos],
  );

  const clusterColorMap = useMemo(() => {
    const map = new Map<string, string>();
    clusterLabels.forEach((cl, i) => {
      map.set(cl.topicId, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]);
    });
    return map;
  }, [clusterLabels]);

  // ── Terrain: edge counts + node lookup ────────────────────────
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const edgeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of edges) {
      counts[edge.fromItemId] = (counts[edge.fromItemId] ?? 0) + 1;
      counts[edge.toItemId] = (counts[edge.toItemId] ?? 0) + 1;
    }
    return counts;
  }, [edges]);

  // Per-edge salience. An edge's rank is the best (lowest) position it holds in
  // either endpoint's weight-sorted edge list, so a hub's weak edge still reads
  // as strong from the leaf node whose single connection it is.
  const edgeSalienceByKey = useMemo(() => {
    const incident = new Map<string, { key: string; weight: number }[]>();
    for (const e of edges) {
      const entry = { key: edgeKey(e.fromItemId, e.toItemId), weight: e.weight };
      for (const nodeId of [e.fromItemId, e.toItemId]) {
        const list = incident.get(nodeId);
        if (list) list.push(entry);
        else incident.set(nodeId, [entry]);
      }
    }

    const bestRank = new Map<string, number>();
    for (const list of incident.values()) {
      list.sort((a, b) => b.weight - a.weight);
      list.forEach((entry, rank) => {
        const prior = bestRank.get(entry.key);
        if (prior === undefined || rank < prior) bestRank.set(entry.key, rank);
      });
    }

    // Edges beyond EDGE_MAX_RANK for both endpoints are left out of the map
    // entirely — undefined at render time means "don't draw", vs. a low
    // number which still means "draw, faintly."
    const salience = new Map<string, number>();
    for (const e of edges) {
      const key = edgeKey(e.fromItemId, e.toItemId);
      const rank = bestRank.get(key) ?? 0;
      if (rank < EDGE_MAX_RANK) salience.set(key, edgeSalience(e.weight, rank));
    }
    return salience;
  }, [edges]);

  // Precompute per-node radius + base opacity (each node's RNG constructed once)
  const nodeMetrics = useMemo(() => {
    const m = new Map<string, { r: number; baseOpacity: number }>();
    for (const node of nodes) {
      const rng = seededRng(hashId(node.id));
      const base = 3.2 + rng() * 2.0;
      const deg = Math.min(edgeCounts[node.id] ?? 0, 8);
      m.set(node.id, { r: base + deg * 0.5, baseOpacity: 0.72 + rng() * 0.28 });
    }
    return m;
  }, [nodes, edgeCounts]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const isRecentNode = useCallback(
    (node: GraphNode): boolean => Date.now() - new Date(node.capturedAt).getTime() < RECENT_MS,
    [], // stable: RECENT_MS is a module constant, date.now() difference only matters per-session
  );

  // ── Tool state ─────────────────────────────────────────────────
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>('default');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const highlightedIds = useMemo<Set<string>>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return new Set();
    return new Set(
      nodes
        .filter((n) =>
          n.label.toLowerCase().includes(q) ||
          n.topics.some((t) => t.name.toLowerCase().includes(q)),
        )
        .map((n) => n.id),
    );
  }, [nodes, searchQuery]);

  const hasSearch = searchQuery.trim().length > 0;

  // ── Discovery mode ─────────────────────────────────────────────
  const [discoveryNodeIds, setDiscoveryNodeIds] = useState<string[]>([]);
  const [discoveryEdgeKeys, setDiscoveryEdgeKeys] = useState<string[]>([]);

  const toggleDiscoveryNode = useCallback((nodeId: string) => {
    setDiscoveryNodeIds((prev) => {
      if (prev.includes(nodeId)) return prev.filter((id) => id !== nodeId);
      if (prev.length >= 5) return [...prev.slice(1), nodeId];
      return [...prev, nodeId];
    });
  }, []);

  // Tapping a connection selects the line *and* both endpoints in one go, so a
  // single tap on the line is enough to open it in the companion. Deselecting
  // releases the endpoints unless another still-selected edge needs them.
  const toggleDiscoveryEdge = useCallback((fromItemId: string, toItemId: string) => {
    const key = edgeKey(fromItemId, toItemId);
    if (discoveryEdgeKeys.includes(key)) {
      const remaining = discoveryEdgeKeys.filter((k) => k !== key);
      const stillNeeded = new Set<string>();
      for (const e of edges) {
        if (remaining.includes(edgeKey(e.fromItemId, e.toItemId))) {
          stillNeeded.add(e.fromItemId);
          stillNeeded.add(e.toItemId);
        }
      }
      setDiscoveryEdgeKeys(remaining);
      setDiscoveryNodeIds((prev) =>
        prev.filter((id) => (id !== fromItemId && id !== toItemId) || stillNeeded.has(id)),
      );
    } else {
      setDiscoveryEdgeKeys((prev) => (prev.length >= 5 ? [...prev.slice(1), key] : [...prev, key]));
      setDiscoveryNodeIds((prev) => {
        const next = [...prev];
        for (const id of [fromItemId, toItemId]) if (!next.includes(id)) next.push(id);
        return next;
      });
    }
  }, [discoveryEdgeKeys, edges]);

  const clearDiscovery = useCallback(() => {
    setDiscoveryNodeIds([]);
    setDiscoveryEdgeKeys([]);
  }, []);

  // Nodes selected outright plus the endpoints of every selected connection —
  // the union is what the companion reasons over.
  const discoveryContextIds = useMemo(() => {
    const s = new Set(discoveryNodeIds);
    for (const e of edges) {
      if (discoveryEdgeKeys.includes(edgeKey(e.fromItemId, e.toItemId))) {
        s.add(e.fromItemId);
        s.add(e.toItemId);
      }
    }
    return s;
  }, [discoveryNodeIds, discoveryEdgeKeys, edges]);

  const openDiscoveryCompanion = useCallback(() => {
    const labelFor = (id: string) =>
      (nodes.find((n) => n.id === id)?.label ?? '').replace(/[,~]/g, ';');

    const ids = Array.from(discoveryContextIds);
    if (ids.length < 2) return;
    const labels = ids.map(labelFor).filter(Boolean);

    // A readable description of each highlighted link so the companion knows
    // *which* connection between the nodes the user is pointing at.
    const connections = edges
      .filter((e) => discoveryEdgeKeys.includes(edgeKey(e.fromItemId, e.toItemId)))
      .map((e) => {
        const a = labelFor(e.fromItemId);
        const b = labelFor(e.toItemId);
        return a && b ? `${a} ~ ${b}` : '';
      })
      .filter(Boolean)
      .join(',');

    router.push({
      pathname: '/companion' as never,
      params: {
        contextIds: ids.join(','),
        contextLabels: labels.join(','),
        ...(connections ? { connections } : {}),
      },
    });
    clearDiscovery();
    setToolMode('default');
  }, [discoveryContextIds, discoveryEdgeKeys, edges, nodes, router, clearDiscovery]);

  // ── Timeline state (temporal lens) ────────────────────────────
  const [timelinePct, setTimelinePct] = useState(1.0);

  const nodeTimestamps = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, new Date(n.capturedAt).getTime());
    return m;
  }, [nodes]);

  // Timeline spans account creation → the present. Start never falls after the
  // earliest capture; end never before the latest capture, so every node maps
  // onto the rail.
  const timeRange = useMemo(() => {
    const now = Date.now();
    let earliest = Infinity, latest = -Infinity;
    for (const ts of nodeTimestamps.values()) {
      if (ts < earliest) earliest = ts;
      if (ts > latest) latest = ts;
    }
    let startMs = accountCreatedMs ?? (earliest === Infinity ? now : earliest);
    if (earliest !== Infinity) startMs = Math.min(startMs, earliest);
    const endMs = Math.max(now, latest === -Infinity ? now : latest);
    return { startMs, endMs };
  }, [nodeTimestamps, accountCreatedMs]);

  const timelineCutoffMs = useMemo(() => {
    if (nodes.length === 0 || timelinePct >= 1) return Infinity;
    const raw = timeRange.startMs + (timeRange.endMs - timeRange.startMs) * timelinePct;
    // Quantize to the next day boundary: node dimming (and with it the heavy
    // graph-layer rebuild) changes at most once per day crossed, while the
    // thumb and date readout still track the finger every frame.
    return Math.ceil(raw / DAY_MS) * DAY_MS;
  }, [nodes.length, timeRange, timelinePct]);

  const animCancelRef = useRef<(() => void) | null>(null);

  const animateCamera = useCallback((targetX: number, targetY: number, targetZoom: number, duration = 900) => {
    if (animCancelRef.current) animCancelRef.current();
    const startX = savedVB.current.x;
    const startY = savedVB.current.y;
    const startZ = savedZoom.current;
    const startTime = Date.now();
    let frameId: number;
    let cancelled = false;
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const frame = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = easeInOutCubic(t);
      const x = startX + (targetX - startX) * eased;
      const y = startY + (targetY - startY) * eased;
      const z = startZ + (targetZoom - startZ) * eased;
      const vbW2 = SW / z;
      const vbH2 = SH / z;
      const cx = clampVBX(x, vbW2);
      const cy = clampVBY(y, vbH2);
      savedVB.current = { x: cx, y: cy };
      savedZoom.current = z;
      applyLiveCamera(cx, cy, z);
      if (t < 1) { maybeRecommit(cx, cy, z); frameId = requestAnimationFrame(frame); }
      else commitCamera();
    };
    frameId = requestAnimationFrame(frame);
    animCancelRef.current = () => { cancelled = true; cancelAnimationFrame(frameId); commitCamera(); };
  }, [applyLiveCamera, commitCamera, maybeRecommit]);

  const centerOnNodes = useCallback((posOverride?: PositionMap, animated = false, animDuration = 720) => {
    const positions = posOverride ?? pos;
    const fit = computeCameraFit(nodes, positions);
    if (!fit) { resetView(); return; }

    if (animated) {
      animateCamera(fit.x, fit.y, fit.zoom, animDuration);
    } else {
      setCamera(fit.x, fit.y, fit.zoom);
    }
  }, [nodes, pos, resetView, animateCamera, setCamera]);

  // Auto-recenter on first data load
  const hasInitiallyLoadedRef = useRef(false);
  useEffect(() => {
    if (nodes.length === 0 || hasInitiallyLoadedRef.current) return;
    hasInitiallyLoadedRef.current = true;
    centerOnNodes(semanticPos);
  }, [nodes.length, semanticPos, centerOnNodes]);

  // Auto-recenter when the Atlas tab gains focus — and ONLY then. This callback
  // MUST keep a stable identity: useFocusEffect re-invokes it on every identity
  // change while the screen is focused, and centerOnNodes is rebuilt each frame
  // of a node ease-in (it closes over the tweened positions). Depending on it
  // directly snapped the camera to the in-flight layout's bounding box ~60x a
  // second, fighting the fly-to-the-new-node animation — the map shook for the
  // length of the ease, then "fixed itself" when the tween stopped.
  const centerOnNodesRef = useRef(centerOnNodes);
  useEffect(() => { centerOnNodesRef.current = centerOnNodes; }, [centerOnNodes]);
  const nodeCountRef = useRef(0);
  useEffect(() => { nodeCountRef.current = nodes.length; }, [nodes.length]);

  useFocusEffect(useCallback(() => {
    if (nodeCountRef.current > 0) centerOnNodesRef.current();
  }, []));

  // Fly the camera to fit whichever map is live: a topic's sub-map once it
  // arrives, or the overview again when focus is cleared. While the sub-map
  // is still loading ('pending') the camera stays where the cluster tap or
  // drawer left it — the dimmed overview is the interim state.
  const focusFitKey = activeFocusGraph ? focusedTopicId! : focusedTopicId ? 'pending' : 'overview';
  const prevFocusFitKeyRef = useRef(focusFitKey);
  useEffect(() => {
    if (prevFocusFitKeyRef.current === focusFitKey) return;
    prevFocusFitKeyRef.current = focusFitKey;
    if (focusFitKey === 'pending' || nodes.length === 0) return;
    // Fit against the fresh semantic layout for the NEW node set — `pos` may
    // still hold the previous set mid-swap (renderPos settles a frame later).
    centerOnNodes(semanticPos, true);
  }, [focusFitKey, nodes.length, centerOnNodes, semanticPos]);

  // Lens-switch camera recentering happens frame-by-frame inside
  // handleLensChange's tick loop (derived from the same in-flight node
  // positions), not as a separate effect here — see computeCameraFit.

  // Momentum tracking for smooth pan release
  const lastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const momentumFrameRef = useRef<number | null>(null);

  const mapPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.touches.length >= 2 ||
        Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3,

      onPanResponderGrant: (evt) => {
        // Cancel any in-flight momentum. That path skips commitCamera, so drop
        // its velocity here or the next commit would aim along the old fling.
        if (momentumFrameRef.current !== null) {
          cancelAnimationFrame(momentumFrameRef.current);
          momentumFrameRef.current = null;
        }
        resetVelocity();
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          pinchStartRef.current = { dist: Math.sqrt(dx * dx + dy * dy), zoom: savedZoom.current };
        }
        lastMoveRef.current = null;
      },

      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2 && pinchStartRef.current) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const raw = pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist);
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, raw));

          // Zoom centered on the *live* pinch mid-point, recomputed every
          // move event. Anchoring to the mid-point captured once at gesture
          // start drifted as soon as the fingers' midpoint shifted (which it
          // always does slightly in a real pinch), making the map appear to
          // pan on its own during zoom.
          const mid = {
            x: (touches[0].pageX + touches[1].pageX) / 2,
            y: (touches[0].pageY + touches[1].pageY) / 2,
          };
          const worldX = savedVB.current.x + mid.x / savedZoom.current;
          const worldY = savedVB.current.y + mid.y / savedZoom.current;
          const vbW = SW / newZoom;
          const vbH = SH / newZoom;
          const nx = clampVBX(worldX - mid.x / newZoom, vbW);
          const ny = clampVBY(worldY - mid.y / newZoom, vbH);

          savedZoom.current = newZoom;
          savedVB.current = { x: nx, y: ny };
          applyLiveCamera(nx, ny, newZoom);
          maybeRecommit(nx, ny, newZoom);
          return;
        }
        // Pan. If a pinch is in progress — including the frame or two at the end
        // where one finger lifts before the other — never treat the lone touch
        // as a pan. Otherwise `gs.dx/dy` (accumulated across the whole pinch)
        // yanks the map sideways, then it snaps back on the next gesture: the
        // "auto-correcting" jitter after zooming.
        if (pinchStartRef.current) return;
        const vbW = SW / savedZoom.current;
        const vbH = SH / savedZoom.current;
        const nx = clampVBX(savedVB.current.x - gs.dx / savedZoom.current, vbW);
        const ny = clampVBY(savedVB.current.y - gs.dy / savedZoom.current, vbH);
        applyLiveCamera(nx, ny, savedZoom.current);
        maybeRecommit(nx, ny, savedZoom.current);
        // Track velocity for momentum
        const now = Date.now();
        lastMoveRef.current = { x: gs.vx, y: gs.vy, t: now };
      },

      onPanResponderTerminate: () => {
        pinchStartRef.current = null;
        commitCamera();
      },

      onPanResponderRelease: (evt, gs) => {
        if (pinchStartRef.current) {
          pinchStartRef.current = null;
          commitCamera();
          return;
        }
        // Commit final pan position
        const vbW = SW / savedZoom.current;
        const vbH = SH / savedZoom.current;
        const nx = clampVBX(savedVB.current.x - gs.dx / savedZoom.current, vbW);
        const ny = clampVBY(savedVB.current.y - gs.dy / savedZoom.current, vbH);
        savedVB.current = { x: nx, y: ny };
        applyLiveCamera(nx, ny, savedZoom.current);

        // Momentum scroll — decay velocity over ~400ms
        const vx = gs.vx * 0.6;
        const vy = gs.vy * 0.6;
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < 0.3) {
          commitCamera();
          return;
        }

        let velX = vx;
        let velY = vy;
        const decay = 0.88;
        const MIN_VEL = 0.05;

        const step = () => {
          velX *= decay;
          velY *= decay;
          if (Math.abs(velX) < MIN_VEL && Math.abs(velY) < MIN_VEL) {
            momentumFrameRef.current = null;
            commitCamera();
            return;
          }
          const z = savedZoom.current;
          const w = SW / z;
          const h = SH / z;
          const mx = clampVBX(savedVB.current.x - velX * 12 / z, w);
          const my = clampVBY(savedVB.current.y - velY * 12 / z, h);
          savedVB.current = { x: mx, y: my };
          applyLiveCamera(mx, my, z);
          maybeRecommit(mx, my, z);
          momentumFrameRef.current = requestAnimationFrame(step);
        };
        momentumFrameRef.current = requestAnimationFrame(step);
      },
    }),
  ).current;

  // ── Drawer state ──────────────────────────────────────────────
  const DRAWER_W = SW * 0.76;
  type ClusterLabel = (typeof clusterLabels)[number];
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerCluster, setDrawerCluster] = useState<ClusterLabel | null>(null);
  const drawerX = useRef(new RNAnimated.Value(DRAWER_W)).current;

  const openDrawer = useCallback((cluster?: ClusterLabel | null) => {
    if (cluster !== undefined) setDrawerCluster(cluster ?? null);
    setDrawerVisible(true);
    RNAnimated.timing(drawerX, { toValue: 0, duration: 320, useNativeDriver: true }).start();
  }, [drawerX]);

  const closeDrawer = useCallback(() => {
    RNAnimated.timing(drawerX, { toValue: DRAWER_W, duration: 260, useNativeDriver: true }).start(() => {
      setDrawerVisible(false);
      setDrawerCluster(null);
      setSelectedNode(null);
    });
  }, [drawerX, DRAWER_W]);

  const handleClusterTap = useCallback((cl: ClusterLabel) => {
    const targetZoom = 1.8;
    const vbW2 = SW / targetZoom;
    const vbH2 = SH / targetZoom;
    animateCamera(cl.x - vbW2 / 2, cl.y - vbH2 / 2, targetZoom);
    setDrawerCluster(cl);
    setSelectedNode(null);
    openDrawer(cl);
  }, [animateCamera, openDrawer]);

  // ── Node selection ────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [deletingNode, setDeletingNode] = useState(false);

  // Permanent delete: the row and everything derived from it (insights,
  // connections, topic links) are removed server-side, then the graph is
  // refetched so the node — and any edges into it — vanish from the map,
  // clusters, and every other surface in the same request.
  const handleDeleteNode = useCallback((node: GraphNode) => {
    Alert.alert(
      'Delete this memory?',
      'This permanently removes it and its connections. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // The walkthrough's practice node only exists locally — clearing
            // the state is the whole delete, no server round-trip.
            if (node.id === TUTORIAL_DEMO_NODE.id) {
              setDemoNode(null);
              closeDrawer();
              if (tutorialActive) notifyTargetPressed(TUTORIAL_TARGET.nodeDelete);
              return;
            }
            setDeletingNode(true);
            try {
              await api.captures.delete(node.id);
              closeDrawer();
              await refetchGraph();
              refetchIntelligence();
              refetchTrends();
              refetchPulse();
              if (tutorialActive) notifyTargetPressed(TUTORIAL_TARGET.nodeDelete);
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setDeletingNode(false);
            }
          },
        },
      ],
    );
  }, [closeDrawer, refetchGraph, refetchIntelligence, refetchTrends, refetchPulse, tutorialActive, notifyTargetPressed]);

  // ── Capture state ─────────────────────────────────────────────
  const [showCapture, setShowCapture] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<CaptureMode>('link');
  const [payload, setPayload] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reaction, setReaction] = useState('');
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');
  // Preflight: what the backend could read from the pasted URL, fetched while
  // the user types their reaction. Drives the "what was this about?" fail-safe.
  const [preflight, setPreflight] = useState<CapturePreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [userContext, setUserContext] = useState('');
  const preflightSeq = useRef(0);

  // First time ever that a source comes back unreadable, explain what
  // happened and what to do about it — after that the inline red line and
  // the context box speak for themselves.
  const [unreadableInfoVisible, setUnreadableInfoVisible] = useState(false);
  useEffect(() => {
    if (mode !== 'link' || preflight?.confidence !== 'thin') return;
    void AsyncStorage.getItem(UNREADABLE_EXPLAINED_KEY).then((seen) => {
      if (seen) return;
      void AsyncStorage.setItem(UNREADABLE_EXPLAINED_KEY, '1');
      // The reaction field may be focused — drop the keyboard so the popup
      // (and the context box under it) is fully visible.
      Keyboard.dismiss();
      setUnreadableInfoVisible(true);
    });
  }, [preflight, mode]);

  const runPreflight = useCallback((url: string) => {
    const seq = ++preflightSeq.current;
    setPreflight(null);
    setPreflightLoading(true);
    const apply = (res: CapturePreflight) => {
      if (preflightSeq.current !== seq) return;
      setPreflight(res);
      setPreflightLoading(false);
    };
    // During the walkthrough the capture is simulated: no scrape, just a
    // beat of "reading…" then a hard-coded rich read, so the demo can never
    // hit a slow or unreadable source.
    if (tutorialActive) {
      setTimeout(() => apply({
        confidence: 'rich',
        title: TUTORIAL_DEMO_NODE.label,
        bodySource: 'article',
      }), 900);
      return;
    }
    api.captures
      .preflight(url)
      // A failed preflight means the scrape failed — treat it as unreadable.
      .catch((): CapturePreflight => ({ confidence: 'thin' }))
      .then(apply);
  }, [tutorialActive]);
  const [newNodeId, setNewNodeId] = useState<string | null>(null);
  const landingAnim = useRef(new RNAnimated.Value(0)).current;
  const animatingRef = useRef(false);

  const slideY = useRef(new RNAnimated.Value(SH)).current;
  const fabPulse = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(fabPulse, {
          toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        RNAnimated.timing(fabPulse, {
          toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fabPulse]);

  // Whether the clipboard currently holds a URL — checked (not read: no iOS
  // paste banner) each time the sheet opens, to promote the paste affordance.
  const [clipboardHasUrl, setClipboardHasUrl] = useState(false);

  const openCapture = useCallback(() => {
    closeDrawer();
    setSelectedNode(null);
    setStep(1); setPayload(''); setReaction('');
    setImageUri(null); setMediaUrl(null); setUploading(false);
    setCaptureError(''); setMode('link');
    setPreflight(null); setPreflightLoading(false); setUserContext('');
    setClipboardHasUrl(false);
    Clipboard.hasUrlAsync().then(setClipboardHasUrl).catch(() => {});
    setShowCapture(true);
    slideY.setValue(SH);
    RNAnimated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 170 }).start();
  }, [closeDrawer, slideY]);

  // The + during the walkthrough: open capture pre-loaded with the example link
  // and advance the tutorial to its "tap next" step.
  const openCaptureFromFab = useCallback(() => {
    openCapture();
    if (tutorialActive) {
      setMode('link');
      setPayload(TUTORIAL_EXAMPLE_LINK);
      notifyTargetPressed(TUTORIAL_TARGET.captureFab);
    }
  }, [openCapture, tutorialActive, notifyTargetPressed]);

  const closeCapture = useCallback(() => {
    RNAnimated.timing(slideY, { toValue: SH, duration: 260, useNativeDriver: true }).start(() => {
      setShowCapture(false);
    });
  }, [slideY]);

  // Shared by "next" (reaction step) and the one-tap quick save.
  const validatePayload = useCallback((): boolean => {
    if (mode === 'image') {
      if (uploading) { setCaptureError('Still reading the image…'); return false; }
      if (!mediaUrl) { setCaptureError('Add an image first.'); return false; }
    } else if (!payload.trim()) {
      setCaptureError('Enter a URL or thought first.'); return false;
    }
    return true;
  }, [mode, payload, mediaUrl, uploading]);

  // Returns whether the form actually advanced, so the walkthrough can key
  // its own progress off real success rather than the button press.
  const goNext = useCallback((): boolean => {
    if (!validatePayload()) return false;
    // Drop the keyboard as we advance to the reaction step so it doesn't cover
    // the preflight status or the reaction field on the way in.
    Keyboard.dismiss();
    if (mode === 'link') {
      runPreflight(normalizeLinkInput(payload));
    }
    setCaptureError(''); setStep(2);
    return true;
  }, [validatePayload, mode, payload, runPreflight]);

  const shareParams = useLocalSearchParams<{
    selectIds?: string; firstCapture?: string;
  }>();

  // Fresh from onboarding (self-guided path): open the capture sheet
  // immediately with a first-capture prompt, so the first thing a new user
  // does is save something — not stare at an empty map.
  const [firstCapturePrompt, setFirstCapturePrompt] = useState(false);
  useEffect(() => {
    if (shareParams.firstCapture !== '1') return;
    router.setParams({ firstCapture: '' });
    setFirstCapturePrompt(true);
    openCapture();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareParams.firstCapture]);
  // Clear the prompt only on a real open→close transition — on first mount
  // this effect fires with the sheet still closed, and clearing there would
  // race the effect above that just set the prompt.
  const prevShowCaptureRef = useRef(false);
  useEffect(() => {
    if (prevShowCaptureRef.current && !showCapture) setFirstCapturePrompt(false);
    prevShowCaptureRef.current = showCapture;
  }, [showCapture]);
  // (Shares from the OS share sheet used to arrive here as route params; they
  // now save directly on the shareintent screen, so only selectIds and
  // firstCapture flow through params.)

  // Arriving from Mind's "View in Atlas" — pre-select the thread's captures in
  // the multi-select (discover) tool and fly the camera to fit them.
  useEffect(() => {
    const raw = shareParams.selectIds;
    if (!raw || nodes.length === 0) return;
    const valid = String(raw).split(',').filter((id) => id && pos[id]);
    if (valid.length === 0) { router.setParams({ selectIds: '' }); return; }
    closeDrawer();
    setSelectedNode(null);
    setToolMode('discover');
    setDiscoveryNodeIds(valid);
    const fit = computeCameraFit(nodes.filter((n) => valid.includes(n.id)), pos);
    if (fit) animateCamera(fit.x, fit.y, fit.zoom, 700);
    router.setParams({ selectIds: '' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareParams.selectIds, nodes.length]);

  const pickImage = useCallback(async (source: 'camera' | 'library') => {
    setCaptureError('');
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setCaptureError('Camera permission is needed to take a photo.'); return; }
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.6,
      };
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      setImageUri(asset.uri);
      setMediaUrl(null);
      setUploading(true);
      const up = await api.captures.upload(asset.base64!, asset.mimeType ?? 'image/jpeg');
      setMediaUrl(up.mediaUrl);
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : 'Could not read that image.');
      setImageUri(null); setMediaUrl(null);
    } finally {
      setUploading(false);
    }
  }, []);

  // Quick save (step-one "save →"): the capture lands on the map with the
  // landing ring plus a transient pill offering the insight — the same
  // "sharing IS the capture" contract as the share-sheet path. The full
  // reaction flow keeps opening the insight screen directly.
  const [savedPill, setSavedPill] = useState<{ id: string } | null>(null);
  const savedPillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSavedPill = useCallback((id: string) => {
    if (savedPillTimer.current) clearTimeout(savedPillTimer.current);
    setSavedPill({ id });
    savedPillTimer.current = setTimeout(() => setSavedPill(null), 6000);
  }, []);
  useEffect(() => () => { if (savedPillTimer.current) clearTimeout(savedPillTimer.current); }, []);

  // A capture shared in from the OS share sheet whose insight was never
  // opened: offer it again on the next visit to the map — including a cold
  // start hours later. Read-and-clear, so the pill shows exactly once.
  useFocusEffect(useCallback(() => {
    void takeRecentSharedCapture().then((id) => {
      if (!id) return;
      void prefetchQuery(`capture:${id}`, () => api.captures.get(id));
      showSavedPill(id);
    });
  }, [showSavedPill]));

  const commit = useCallback(async (opts?: { quick?: boolean }) => {
    // Drop the keyboard the moment they commit, so it doesn't linger over the
    // saving state or the map while the insight is generated.
    Keyboard.dismiss();
    setBusy(true); setCaptureError('');
    // Walkthrough commit is simulated end-to-end: a beat of the saving loader,
    // then a local demo node dropped at the centre of the current viewport —
    // no server write, no AI, nothing that can vary or fail. The landing ring
    // and ease-in animations are the same ones a real capture triggers.
    if (tutorialActive) {
      await new Promise((r) => setTimeout(r, 1600));
      const worldX = savedVB.current.x + (SW / 2) / savedZoom.current;
      const worldY = savedVB.current.y + (SH / 2) / savedZoom.current;
      setDemoNode({
        id: TUTORIAL_DEMO_NODE.id,
        label: TUTORIAL_DEMO_NODE.label,
        kind: 'LINK',
        topics: [],
        capturedAt: new Date().toISOString(),
        reaction: reaction.trim() || null,
        keyIdea: TUTORIAL_DEMO_NODE.keyIdea,
        x: Math.min(0.92, Math.max(0.08, (worldX - MAP_PAD) / LAYOUT_W)),
        y: Math.min(0.92, Math.max(0.08, (worldY - MAP_PAD) / LAYOUT_H)),
      });
      setNewNodeId(TUTORIAL_DEMO_NODE.id);
      setBusy(false);
      closeCapture();
      return;
    }
    try {
      let kind: CaptureKind = 'TEXT';
      let url: string | undefined;
      let text: string | undefined;
      if (mode === 'link') { kind = 'LINK'; url = normalizeLinkInput(payload); }
      else if (mode === 'image') { kind = 'IMAGE'; }
      else { kind = 'TEXT'; text = payload.trim(); }
      const res = await api.captures.create({
        kind,
        url,
        text,
        mediaUrl: mode === 'image' ? mediaUrl ?? undefined : undefined,
        reaction: reaction.trim() || undefined,
        userContext: mode === 'link' ? userContext.trim() || undefined : undefined,
      });
      setNewNodeId(res.id);
      refetchMapData();
      closeCapture();
      if (opts?.quick) {
        // Warm the insight screen while the pill is on screen — the server is
        // polishing the drafts in the background, and by the time the user
        // taps "see the insight" the screen opens instantly from cache.
        void prefetchQuery(`capture:${res.id}`, () => api.captures.get(res.id));
        showSavedPill(res.id);
      } else {
        router.push(`/insight/${res.id}` as never);
      }
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      setBusy(false);
    }
  }, [mode, payload, mediaUrl, reaction, userContext, refetchMapData, closeCapture, router, tutorialActive, showSavedPill]);

  const quickSave = useCallback(() => {
    if (!validatePayload()) return;
    Keyboard.dismiss();
    setCaptureError('');
    void commit({ quick: true });
  }, [validatePayload, commit]);

  const pasteFromClipboard = useCallback(async () => {
    const t = (await Clipboard.getStringAsync()).trim();
    if (!t) return;
    setPayload(t);
    if (/^https?:\/\//i.test(t)) setMode('link');
  }, []);

  const glowOpacity = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.16] });
  const glowScale = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.05] });
  const isEmpty = !graphLoading && nodes.length === 0;

  useEffect(() => {
    if (toolMode === 'search') {
      setTimeout(() => searchInputRef.current?.focus(), 120);
    }
    // Exit discover mode if switching away
    if (toolMode !== 'discover') {
      clearDiscovery();
    }
  }, [toolMode, clearDiscovery]);

  useEffect(() => {
    if (!newNodeId || !semanticPos[newNodeId] || animatingRef.current) return;
    animatingRef.current = true;
    // Route the user to their new capture: fly the camera to where it SETTLES
    // so "saved" visibly means "it's on your map, right here". Aim at the
    // semantic target, not the live (tweened) position: the node is seeded at
    // its nearest neighbour and eases home over the next 600ms, so flying to
    // where it starts leaves it drifting off-centre as it slides.
    // The walkthrough manages its own framing, so the demo node never moves
    // the camera.
    if (!tutorialActive) {
      const p = semanticPos[newNodeId]!;
      const targetZoom = Math.max(savedZoom.current, 1.5);
      animateCamera(p.x - (SW / targetZoom) / 2, p.y - (SH / targetZoom) / 2, targetZoom, 700);
    }
    landingAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(landingAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      RNAnimated.timing(landingAnim, { toValue: 0, duration: 750, useNativeDriver: true }),
    ]).start(() => { animatingRef.current = false; setNewNodeId(null); });
  }, [newNodeId, semanticPos, landingAnim, tutorialActive, animateCamera]);

  const nodeColor = useCallback((node: GraphNode): string => {
    const clusterColor = node.topics.reduce<string | undefined>(
      (acc, t) => acc ?? clusterColorMap.get(t.topicId),
      undefined,
    );
    if (clusterColor) return clusterColor;
    return isRecentNode(node) ? '#D4B896' : MAP_NODE;
  }, [clusterColorMap, isRecentNode]);

  const landingRing = newNodeId && pos[newNodeId] ? (() => {
    const p = pos[newNodeId]!;
    const screenX = (p.x - vbPos.x) * zoom;
    const screenY = (p.y - vbPos.y) * zoom;
    const ringSize = 44;
    const newNodeRingScale = landingAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.5, 2.4, 3.8] });
    const newNodeRingOpacity = landingAnim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.55, 0] });
    return (
      <RNAnimated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: ringSize, height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: 1.5, borderColor: MAP_NODE,
          left: screenX - ringSize / 2, top: screenY - ringSize / 2,
          transform: [{ scale: newNodeRingScale }],
          opacity: newNodeRingOpacity,
        }}
      />
    );
  })() : null;

  // ── Node opacity: terrain + focus + discovery + timeline ───────
  const getNodeOpacity = useCallback((node: GraphNode, baseOpacity: number, zoomFade: number) => {
    // Search dimming
    if (hasSearch && !highlightedIds.has(node.id)) {
      return baseOpacity * 0.10 * zoomFade;
    }
    // Timeline cutoff (temporal lens)
    if (lensMode === 'temporal') {
      const ts = nodeTimestamps.get(node.id) ?? 0;
      if (ts > timelineCutoffMs) {
        return baseOpacity * 0.08 * zoomFade;
      }
    }
    // Focus dimming (interim only — a live sub-map has no non-members)
    if (focusDimTopicId && !node.topics.some((t) => t.topicId === focusDimTopicId)) {
      return baseOpacity * 0.06 * zoomFade;
    }
    return baseOpacity * zoomFade;
  }, [hasSearch, highlightedIds, lensMode, nodeTimestamps, timelineCutoffMs, focusDimTopicId]);

  // ── Map world body — everything drawn in world coordinates ─────
  // Deliberately independent of vbPos: panning only slides the viewBox, so
  // this subtree keeps its element identity and React skips reconciling it
  // entirely on a pan re-commit. Only a zoom change rebuilds it (label sizes
  // and the zoom fade are the sole zoom-dependent bits).
  //
  // The backdrop (dot grid + tonal wash) is NOT drawn here. It lives in the
  // screen-fixed layer behind the canvas, which paints the same grid and tone.
  // Filling it here too meant re-rasterizing a Pattern and a gradient across
  // the whole overscanned area on every commit — a duplicate backdrop, and
  // the bulk of the per-commit cost.
  // Nodes stay visible at every zoom level — never fade to zero. Only a gentle
  // dimming as you pull back, floored so points (and their colour) remain
  // clearly readable when fully zoomed out. Hoisted out of the node loop: it
  // is a plain function of zoom, and it is CONSTANT outside 0.6 < zoom < 0.9,
  // so keying the graph on it (rather than on zoom) means a pinch that stays
  // zoomed in rebuilds no nodes at all.
  const zoomFade = useMemo(
    () => Math.max(0.6, Math.min(1, (zoom - 0.15) / 0.75)),
    [zoom],
  );

  // Gradients live at the <Svg> level; only the cluster set changes them.
  const worldDefs = useMemo(() => (
    <Defs>
      {clusterLabels.map((cl, i) => {
        const color = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
        return (
          <RadialGradient key={`grad-${cl.topicId}`} id={`clGrad-${cl.topicId}`} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.14} />
            <Stop offset="55%" stopColor={color} stopOpacity={0.04} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        );
      })}
    </Defs>
  ), [clusterLabels]);

  const haloLayer = useMemo(() => (
    <>
          {/* Cluster region halos — only in semantic mode */}
          {lensMode === 'semantic' && clusterLabels.map((cl) => {
            const clusterR = Math.min(LAYOUT_W, LAYOUT_H) * 0.16;
            const dimmed = focusDimTopicId && cl.topicId !== focusDimTopicId;
            return (
              <Circle
                key={`cl-area-${cl.topicId}`}
                cx={cl.x} cy={cl.y} r={clusterR}
                fill={`url(#clGrad-${cl.topicId})`}
                fillOpacity={dimmed ? 0.2 : 1}
              />
            );
          })}
    </>
  ), [lensMode, clusterLabels, focusDimTopicId]);

  // The only genuinely zoom-dependent art: text counter-scaled to stay a
  // constant size on screen. A dozen elements, so rebuilding it per zoom
  // commit is cheap — which is the whole reason it is split from the graph.
  const labelLayer = useMemo(() => {
    // Sub-topic labels are shown at every zoom, except where one would sit on
    // top of a coarse domain label — there it stays zoom-gated so the two don't
    // pile up while zoomed out. Approximate each label's world-space box (mono
    // uppercase, so char advance ≈ 0.6·fontSize + letterSpacing) at the current
    // zoom and test axis-aligned overlap. Boxes shrink as the user zooms in, so
    // a colliding pair naturally separates and the sub-topic label appears.
    const domainFontSize = Math.max(9, Math.min(22, 14 / zoom));
    const topicFontSize = Math.max(7, Math.min(14, 10 / zoom));
    const labelHalfBox = (name: string, fontSize: number, letterSpacing: number) => ({
      hw: (name.length * (fontSize * 0.6 + letterSpacing)) / 2,
      hh: fontSize / 2,
    });
    const domainBoxes = lensMode === 'semantic'
      ? clusterLabels
        .filter((cl) => cl.kind === 'domain')
        .map((cl) => ({ x: cl.x, y: cl.y, ...labelHalfBox(cl.name, domainFontSize, 3.5) }))
      : [];
    const overlapsDomain = (cl: { x: number; y: number; name: string }) => {
      const b = labelHalfBox(cl.name, topicFontSize, 3);
      return domainBoxes.some(
        (d) => Math.abs(cl.x - d.x) < b.hw + d.hw && Math.abs(cl.y - d.y) < b.hh + d.hh,
      );
    };

    return (
      <>
          {/* Cluster labels (semantic mode only) — hierarchical: coarse
              domain labels own the zoomed-out view; the more specific
              topic labels fade in as the user zooms into their region. */}
          {lensMode === 'semantic' && clusterLabels.map((cl) => {
            const isDomain = cl.kind === 'domain';
            const clFontSize = isDomain ? domainFontSize : topicFontSize;
            // Domain labels own the zoomed-out view and fade as you zoom in.
            // Sub-topic labels are always visible, faded to the same
            // plateau as domain labels — unless they would collide with a
            // domain label, in which case they fade in only once zoomed in
            // enough to clear it.
            let clOpacity: number;
            let cap: number;
            if (isDomain) {
              clOpacity = zoom <= 1.0
                ? 0.12 + (1 - zoom) * 0.10
                : Math.max(0, 0.12 * (1 - (zoom - 1.0) / 0.6));
              cap = 0.28;
            } else if (overlapsDomain(cl)) {
              clOpacity = zoom <= 1.1 ? 0 : Math.min(0.28, ((zoom - 1.1) / 0.5) * 0.28);
              cap = 0.28;
            } else {
              clOpacity = 0.28;
              cap = 0.28;
            }
            if (clOpacity <= 0.005) return null;
            const dimmed = focusDimTopicId && cl.topicId !== focusDimTopicId;
            return (
              <SvgText
                key={`cl-label-${cl.topicId}`}
                x={cl.x} y={cl.y}
                fontSize={clFontSize}
                fontFamily={FontFamily.mono}
                fill="rgba(236,236,236,1)"
                fillOpacity={dimmed ? Math.min(0.08, clOpacity) : Math.min(cap, clOpacity)}
                textAnchor="middle"
                letterSpacing={isDomain ? 3.5 : 3}
              >
                {cl.name.toUpperCase()}
              </SvgText>
            );
          })}


          {/* Temporal axis label */}
          {lensMode === 'temporal' && nodes.length > 0 && (() => {
            const fontSize = Math.max(8, Math.min(14, 10 / zoom));
            return (
              <>
                <SvgText
                  x={MAP_PAD + 20} y={MAP_PAD + LAYOUT_H * 0.85}
                  fontSize={fontSize} fontFamily={FontFamily.mono}
                  fill="rgba(236,236,236,1)" fillOpacity={0.15}
                  letterSpacing={2}
                >
                  OLDER
                </SvgText>
                <SvgText
                  x={MAP_PAD + LAYOUT_W - 20} y={MAP_PAD + LAYOUT_H * 0.85}
                  fontSize={fontSize} fontFamily={FontFamily.mono}
                  fill="rgba(236,236,236,1)" fillOpacity={0.15}
                  textAnchor="end" letterSpacing={2}
                >
                  RECENT
                </SvgText>
              </>
            );
          })()}
      </>
    );
  }, [zoom, lensMode, lensTransitioning, clusterLabels, focusDimTopicId, nodes.length]);

  // Edges + nodes: the bulk of the SVG tree. Keyed on zoomFade, not zoom, so a
  // zoom commit outside the fade band keeps this element identity and React
  // skips the whole subtree.
  const graphLayer = useMemo(() => (
    <>
          {/* Edges */}
          {edges.map((e, i) => {
            const a = pos[e.fromItemId];
            const b = pos[e.toItemId];
            if (!a || !b) return null;

            const key = edgeKey(e.fromItemId, e.toItemId);
            const isSelectedEdge = discoveryEdgeKeys.includes(key);

            // Salience maps the strong-few / weak-many split onto both opacity
            // and width: strong connections stay crisp, the long tail recedes.
            // Undefined means past EDGE_MAX_RANK for both endpoints — skip it,
            // unless the user explicitly selected it in discovery mode.
            const salience = edgeSalienceByKey.get(key);
            if (salience === undefined && !isSelectedEdge) return null;
            let edgeOpacity = EDGE_MIN_OPACITY + (salience ?? 0) * (EDGE_MAX_OPACITY - EDGE_MIN_OPACITY);
            const edgeWidth = EDGE_MIN_WIDTH + (salience ?? 0) * (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH);
            if (focusDimTopicId) {
              const fromNode = nodeById.get(e.fromItemId);
              const toNode = nodeById.get(e.toItemId);
              const fromInFocus = fromNode?.topics.some((t) => t.topicId === focusDimTopicId);
              const toInFocus = toNode?.topics.some((t) => t.topicId === focusDimTopicId);
              if (!fromInFocus && !toInFocus) edgeOpacity *= 0.08;
            }

            return (
              <Line
                key={`e${i}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={isSelectedEdge ? DISCOVERY_ACCENT : MAP_LINE}
                strokeWidth={isSelectedEdge ? 2.4 : edgeWidth}
                strokeOpacity={isSelectedEdge ? 0.95 : edgeOpacity}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const p = pos[node.id];
            if (!p) return null;
            const { r: baseR, baseOpacity } = nodeMetrics.get(node.id) ?? { r: 4, baseOpacity: 0.8 };
            const color = nodeColor(node);
            const recent = isRecentNode(node);

            const isHighlighted = hasSearch && highlightedIds.has(node.id);
            const isDiscoverySelected = discoveryNodeIds.includes(node.id);

            const finalOpacity = getNodeOpacity(node, baseOpacity, zoomFade);

            const glowR = isHighlighted || isDiscoverySelected ? baseR * 9 : baseR * 5.5;
            const glowOp = (isHighlighted || isDiscoverySelected) ? 0.12 : 0.03;
            const innerGlowOp = (isHighlighted || isDiscoverySelected) ? 0.28 : 0.09;

            return (
              <G key={node.id}>
                <Circle cx={p.x} cy={p.y} r={glowR} fill={color} fillOpacity={finalOpacity === 0 ? 0 : glowOp * zoomFade} />
                <Circle cx={p.x} cy={p.y} r={baseR * 2.8} fill={color} fillOpacity={finalOpacity === 0 ? 0 : innerGlowOp * zoomFade} />
                <Circle
                  cx={p.x} cy={p.y}
                  r={(isHighlighted || isDiscoverySelected) ? baseR * 1.7 : baseR}
                  fill={(isHighlighted || isDiscoverySelected || recent) ? color : MAP_NODE}
                  fillOpacity={finalOpacity}
                />
                {/* Subtle ring around discovery selected nodes */}
                {isDiscoverySelected && (
                  <Circle
                    cx={p.x} cy={p.y} r={baseR * 2.2}
                    fill="none"
                    stroke="#7EC8A0"
                    strokeWidth={0.8}
                    strokeOpacity={0.6 * zoomFade}
                  />
                )}
                {/* Subtle pulse ring for recent nodes */}
                {recent && !isDiscoverySelected && (
                  <Circle
                    cx={p.x} cy={p.y} r={baseR * 1.6}
                    fill="none"
                    stroke={color}
                    strokeWidth={0.5}
                    strokeOpacity={0.3 * zoomFade}
                  />
                )}
              </G>
            );
          })}

          {/* Empty state ghost dots */}
          {isEmpty && [
            [0.28, 0.28], [0.58, 0.22], [0.72, 0.45], [0.62, 0.60],
            [0.36, 0.58], [0.48, 0.38], [0.42, 0.50], [0.68, 0.33],
            [0.30, 0.42], [0.55, 0.52], [0.44, 0.30], [0.65, 0.55],
          ].map(([rx, ry], i) => (
            <Circle
              key={`g${i}`}
              cx={MAP_PAD + LAYOUT_W * rx!}
              cy={MAP_PAD + LAYOUT_H * ry!}
              r={2.5} fill={MAP_NODE} fillOpacity={0.07}
            />
          ))}
    </>
  ), [
    edges, nodes, pos, nodeById, discoveryEdgeKeys, discoveryNodeIds,
    nodeMetrics, nodeColor, isRecentNode, hasSearch, highlightedIds,
    getNodeOpacity, isEmpty, focusDimTopicId, zoomFade, edgeSalienceByKey,
  ]);

  const worldBody = useMemo(() => (
    <G>
      {haloLayer}
      {labelLayer}
      {graphLayer}
    </G>
  ), [haloLayer, labelLayer, graphLayer]);

  // ── Map world (SVG) — memoized against the COMMITTED camera ────
  // Render an OVERSCAN margin of real map beyond the viewport. An <Svg> clips
  // to its own width/height, so a screen-sized one has nothing to show the
  // instant the wrapper transform moves it. Offsetting the element by −MARGIN
  // and widening the viewBox to match keeps the scale and the world→screen
  // mapping identical — (world − vbPos)·zoom, exactly what the touch layer
  // assumes — while giving pans and zoom-outs charted territory to reveal.
  //
  // A pan re-commit changes nothing here but the viewBox string; worldBody
  // comes through by reference, so React reconciles one element, not the graph.
  const mapWorld = useMemo(() => (
    <Svg
      width={OS_W}
      height={OS_H}
      viewBox={`${vbPos.x - MARGIN_X / zoom} ${vbPos.y - MARGIN_Y / zoom} ${OS_W / zoom} ${OS_H / zoom}`}
      style={MAP_WORLD_STYLE}
    >
      {worldDefs}
      {worldBody}
    </Svg>
  ), [vbPos, zoom, worldDefs, worldBody]);

  // ── Ambient glow — hoisted out of the re-rasterized layer ──────
  // A single smooth radial gradient anchored to the canvas. Drawn inside the
  // world SVG it was a full-area gradient fill re-rasterized on every commit,
  // the last area-proportional cost left in that layer. Its content is static,
  // so rasterize it once at a fixed size and let a plain View place and scale
  // it: a commit now updates a layer transform instead of repainting a million
  // pixels. Upscaling a smooth gradient is invisible.
  const ambientGlow = useMemo(() => (
    <Svg width={GLOW_W} height={GLOW_H}>
      <Defs>
        <RadialGradient id="ambientGlow" cx="50%" cy="44%" r="48%" fx="50%" fy="44%">
          <Stop offset="0%" stopColor={MAP_NODE} stopOpacity={0.06} />
          <Stop offset="100%" stopColor={MAP_NODE} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={GLOW_W} height={GLOW_H} fill="url(#ambientGlow)" />
    </Svg>
  ), []);

  // Place the fixed-size glow over the canvas rect at the committed camera.
  // Uniform scale, so the aspect stays exactly CANVAS_W : CANVAS_H.
  const glowStyle = useMemo(() => ({
    position: 'absolute' as const,
    left: (CANVAS_W / 2 - vbPos.x) * zoom - GLOW_W / 2,
    top: (CANVAS_H / 2 - vbPos.y) * zoom - GLOW_H / 2,
    width: GLOW_W,
    height: GLOW_H,
    transform: [{ scale: (CANVAS_W * zoom) / GLOW_W }],
  }), [vbPos, zoom]);

  // ── Touch layer — memoized against the SETTLED camera ──────────
  // Hit targets are positioned at settled screen coordinates; mid-gesture they
  // ride along inside the transformed wrapper. They drift from their nodes
  // while a gesture is in flight — harmless, since the PanResponder owns the
  // touch until it settles, and settling realigns them.
  const touchLayer = useMemo(() => (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
    >
      {/* Connection touch targets (discover mode only) — several small hits
          spread along the middle of each line so you can tap the line
          itself, not just its exact midpoint. The endpoints are left to
          the node targets (rendered after, so a node always wins). */}
      {toolMode === 'discover' && edges.flatMap((e, i) => {
        const a = pos[e.fromItemId];
        const b = pos[e.toItemId];
        if (!a || !b) return [];
        const EHIT = 16;
        return [0.3, 0.45, 0.6, 0.75].map((t) => {
          const screenX = (a.x + (b.x - a.x) * t - settledCam.x) * settledCam.zoom;
          const screenY = (a.y + (b.y - a.y) * t - settledCam.y) * settledCam.zoom;
          if (screenX < -EHIT || screenX > SW + EHIT || screenY < -EHIT || screenY > SH + EHIT) return null;
          return (
            <Pressable
              key={`etap-${i}-${t}`}
              style={{ position: 'absolute', width: EHIT * 2, height: EHIT * 2, left: screenX - EHIT, top: screenY - EHIT, borderRadius: EHIT }}
              onPress={() => toggleDiscoveryEdge(e.fromItemId, e.toItemId)}
              accessibilityLabel="Toggle connection"
              accessibilityRole="button"
            />
          );
        });
      })}
      {nodes.map((node) => {
        const p = pos[node.id];
        if (!p) return null;
        const screenX = (p.x - settledCam.x) * settledCam.zoom;
        const screenY = (p.y - settledCam.y) * settledCam.zoom;
        const HIT = 38;
        if (screenX < -HIT || screenX > SW + HIT || screenY < -HIT || screenY > SH + HIT) return null;
        // The walkthrough's node-management step points at the demo node
        // specifically (by its stable id — newNodeId is cleared as soon as
        // the landing animation ends, well before this step activates).
        const isTutorialNode = nodeTarget.isActive && node.id === TUTORIAL_DEMO_NODE.id;
        return (
          <Pressable
            key={node.id}
            ref={isTutorialNode ? nodeTarget.ref : undefined}
            onLayout={isTutorialNode ? nodeTarget.onLayout : undefined}
            style={{ position: 'absolute', width: HIT * 2, height: HIT * 2, left: screenX - HIT, top: screenY - HIT, borderRadius: HIT }}
            onPress={() => {
              if (toolMode === 'discover') {
                toggleDiscoveryNode(node.id);
              } else {
                if (selectedNode?.id === node.id) {
                  closeDrawer();
                } else {
                  setSelectedNode(node);
                  setDrawerCluster(null);
                  openDrawer(null);
                }
                if (isTutorialNode) nodeTarget.press();
              }
            }}
            accessibilityLabel={node.label}
            accessibilityRole="button"
          />
        );
      })}
      {/* Cluster label touch targets (semantic mode only) */}
      {lensMode === 'semantic' && clusterLabels.map((cl) => {
        const screenX = (cl.x - settledCam.x) * settledCam.zoom;
        const screenY = (cl.y - settledCam.y) * settledCam.zoom;
        if (screenX < -60 || screenX > SW + 60 || screenY < -30 || screenY > SH + 30) return null;
        return (
          <Pressable
            key={`cl-tap-${cl.topicId}`}
            style={{ position: 'absolute', left: screenX - 52, top: screenY - 18, width: 104, height: 36 }}
            onPress={() => handleClusterTap(cl)}
            accessibilityLabel={`${cl.name} cluster`}
            accessibilityRole="button"
          />
        );
      })}
    </View>
  ), [
    toolMode, edges, pos, settledCam, nodes, nodeTarget,
    selectedNode, toggleDiscoveryEdge, toggleDiscoveryNode, closeDrawer,
    openDrawer, lensMode, clusterLabels, handleClusterTap,
  ]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: mapBg }]}>

      {/* The map's backdrop: dot grid + tonal wash, screen-fixed and drawn
          once. The world SVG above is transparent, so this shows through
          everywhere — including any sliver the transformed world hasn't
          covered mid-gesture, which therefore reads as more map rather than a
          darker box around charted territory. Keeping it out of the world
          layer is what stops every re-commit from re-rasterizing a Pattern
          and a gradient across the whole overscanned area. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SW} height={SH} style={StyleSheet.absoluteFill}>
          <Defs>
            <Pattern id="staticDotGrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <Circle cx="16" cy="16" r="0.9" fill={MAP_NODE} fillOpacity={0.04} />
            </Pattern>
            <LinearGradient id="staticBgTone" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={MAP_NODE} stopOpacity={0.012} />
              <Stop offset="100%" stopColor={MAP_NODE} stopOpacity={0.03} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={SW} height={SH} fill="url(#staticDotGrid)" />
          <Rect x="0" y="0" width={SW} height={SH} fill="url(#staticBgTone)" />
        </Svg>
      </View>

      {/* Pannable map canvas. The wrapper transform carries per-frame gesture
          motion (live camera); the memoized world inside is rendered at the
          committed camera and never re-renders mid-gesture. Keep this subtree
          small — every child is recomposited on each frame of the transform. */}
      <View
        style={StyleSheet.absoluteFill}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) {
            wrapperSize.current = { w: width, h: height };
            // Keep any in-flight transform consistent with the new centre.
            applyLiveCamera(liveCam.current.x, liveCam.current.y, liveCam.current.zoom);
          }
        }}
      >
        <View style={[StyleSheet.absoluteFill, { overflow: 'visible' }]} {...mapPan.panHandlers}>
          <RNAnimated.View
            style={[
              StyleSheet.absoluteFill,
              // The world SVG extends OVERSCAN beyond this view on every side;
              // it must not be clipped back to the viewport, or the overscan
              // buys nothing. (Screen edges still clip at the root.)
              { overflow: 'visible' },
              { transform: [{ translateX: liveTx }, { translateY: liveTy }, { scale: liveScale }] },
            ]}
          >
            {/* Canvas-anchored ambient glow, under the map. Rasterized once;
                a commit only moves and scales this view. */}
            <View style={glowStyle} pointerEvents="none">{ambientGlow}</View>
            {mapWorld}
            {/* New node landing animation */}
            {landingRing}
          </RNAnimated.View>

          {/* Node touch targets — deliberately OUTSIDE the transform. They are
              built against the settled camera, so when the map is at rest the
              wrapper transform is the identity and they sit exactly over their
              nodes. Riding along inside meant CoreAnimation recomposited one
              native view per node on every gesture frame — the cost that grew
              with how fast you moved — to keep hit targets aligned that the
              PanResponder makes unreachable until the gesture settles.
              PanResponder still steals drags from them. */}
          {touchLayer}
        </View>
      </View>

      {/* Timeline scrubber (temporal lens) — centered in the real gap between
          the header buttons and the Socratic FAB (which shares the rail's
          right edge), nudged up a bit above dead-center. */}
      {lensMode === 'temporal' && nodes.length > 0 && !showCapture && !drawerVisible && (() => {
        const zoneTop = (headerH || insets.top + 90) + Spacing[4];
        const zoneBottom = SH - SOCRATIC_FAB_BOTTOM - SOCRATIC_FAB_SIZE - Spacing[4];
        const zoneH = Math.max(zoneBottom - zoneTop, 120);
        const railH = Math.min(zoneH, 440);
        const railTop = Math.max(zoneTop, zoneTop + (zoneH - railH) / 2 - Spacing[4]);
        return (
          <TimelineScrubber
            startMs={timeRange.startMs}
            endMs={timeRange.endMs}
            pct={timelinePct}
            onChange={setTimelinePct}
            top={railTop}
            railH={railH}
          />
        );
      })()}

      {/* Fixed overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        {/* Header */}
        <View
          style={[styles.header, { paddingTop: insets.top + 6 }]}
          onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
          pointerEvents="box-none"
        >
          <View style={styles.headerLeft} pointerEvents="box-none">
            <View pointerEvents="box-none">
              <View style={styles.headerTitleRow} pointerEvents="box-none">
                <Text variant="wordmark" style={{ color: 'rgba(236,236,236,0.85)' }}>atlas</Text>
                <Pressable
                  onPress={() => setInfoVisible(true)}
                  hitSlop={12}
                  accessibilityLabel="About atlas"
                  style={{ marginLeft: Spacing[3] }}
                  pointerEvents="auto"
                >
                  <Text style={{ color: 'rgba(236,236,236,0.35)', fontSize: 16 }}>ⓘ</Text>
                </Pressable>
                <Pressable
                  onPress={() => startTutorial()}
                  hitSlop={12}
                  accessibilityLabel="Start tutorial"
                  style={{ marginLeft: Spacing[3] }}
                  pointerEvents="auto"
                >
                  <Text style={{ color: 'rgba(236,236,236,0.35)', fontSize: 16 }}>ⓣ</Text>
                </Pressable>
              </View>
              {/* Lens picker — registered so the walkthrough can spotlight it.
                  collapsable={false} keeps the View measurable on Android. */}
              <View
                ref={lensTarget.ref}
                onLayout={lensTarget.onLayout}
                collapsable={false}
                style={styles.lensRow}
                pointerEvents="box-none"
              >
                {(['semantic', 'temporal'] as LensMode[]).map((l, i) => {
                  const label = l === 'temporal' ? 'time' : l;
                  const active = lensMode === l;
                  return (
                    <React.Fragment key={l}>
                      {i > 0 && (
                        <Text style={styles.lensDot}>·</Text>
                      )}
                      <Pressable
                        onPress={() => handleLensChange(l)}
                        hitSlop={10}
                        pointerEvents="auto"
                        accessibilityLabel={`${label} lens`}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.lensLabel, { color: active ? 'rgba(236,236,236,0.65)' : 'rgba(236,236,236,0.22)' }]}>
                          {label.toUpperCase()}
                        </Text>
                      </Pressable>
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          </View>
          <View style={styles.headerRight} pointerEvents="box-none">
            {graphLoading && (
              <View style={{ marginRight: Spacing[3] }}>
                <LoadingDots size={4} color="rgba(236,236,236,0.4)" />
              </View>
            )}
            <View pointerEvents="auto">
              <Toolbar
                toolMode={toolMode}
                setToolMode={setToolMode}
                onRecenter={() => centerOnNodes()}
                // Kept visible through the walkthrough even if the map is
                // empty (the demo node was just deleted), so its spotlight
                // step always has a real button to frame.
                showRecenter={(nodes.length > 0 || tutorialActive) && !showCapture}
                c={c}
              />
            </View>
            <Pressable
              onPress={() => setThemeMode(isDarkMode ? 'light' : 'dark')}
              style={{ marginLeft: Spacing[2], padding: 6 }}
              hitSlop={8}
              accessibilityLabel="Toggle theme"
              pointerEvents="auto"
            >
              {isDarkMode
                ? <Sun size={15} color="rgba(236,236,236,0.4)" strokeWidth={1.5} />
                : <Moon size={15} color="rgba(236,236,236,0.6)" strokeWidth={1.5} />}
            </Pressable>
          </View>
        </View>

        <InfoModal
          visible={infoVisible}
          onClose={() => setInfoVisible(false)}
          title="atlas"
          body="Your knowledge map. Every node is something you saved. Lines appear when ideas share a topic, contradict each other, or grow out of one another. Switch lenses to sort the map by meaning or time."
        />

        <InfoModal
          visible={unreadableInfoVisible}
          onClose={() => setUnreadableInfoVisible(false)}
          title="couldn't read that source"
          body="mneme tried to read the page but was blocked — some sites shut out automated readers. when that happens, just give it a few words about the piece, typed or spoken with the mic, and mneme builds the node and its connections from your summary instead."
        />

        {/* Info panel (top-right map summary) */}
        {nodes.length > 0 && !showCapture && !drawerVisible && lensMode !== 'temporal' &&
          toolMode !== 'search' && !(toolMode === 'discover' && (discoveryNodeIds.length > 0 || discoveryEdgeKeys.length > 0)) && (
          <InfoPanel
            top={insets.top + 58}
            collapsed={infoCollapsed}
            onToggle={() => setInfoCollapsed((v) => !v)}
            pointCount={nodes.length}
            totalPointCount={totalCaptureCount}
            fieldCount={fieldCount}
            connectionCount={edges.length}
            tensionCount={tensionCount}
            exciting={excitingLine}
            onNavigate={(route) => router.push(route as never)}
          />
        )}

        {/* Focus mode indicator */}
        {focusedTopicId && !showCapture && (
          <View style={[styles.focusBadge, { top: insets.top + 80, backgroundColor: 'rgba(10,10,10,0.85)', borderColor: 'rgba(255,255,255,0.12)' }]} pointerEvents="auto">
            <Text style={[styles.focusBadgeText, { color: 'rgba(236,236,236,0.5)' }]}>
              {clusters.find((cl) => cl.topicId === focusedTopicId)?.name ?? ''}
              {activeFocusGraph
                ? ` · ${activeFocusGraph.totalCount > activeFocusGraph.nodes.length
                  ? `${activeFocusGraph.nodes.length} of ${activeFocusGraph.totalCount}`
                  : activeFocusGraph.totalCount}`
                : ' · opening…'}
            </Text>
            <Pressable onPress={() => setFocusedTopicId(null)} hitSlop={8} style={{ marginLeft: Spacing[2] }}>
              <Text style={[styles.focusBadgeText, { color: 'rgba(236,236,236,0.35)' }]}>×</Text>
            </Pressable>
          </View>
        )}

        {/* Search bar */}
        {toolMode === 'search' && (
          <View
            style={[styles.searchBar, { top: insets.top + 80, backgroundColor: 'rgba(14,14,14,0.92)', borderColor: 'rgba(255,255,255,0.12)' }]}
            pointerEvents="auto"
          >
            <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: 'rgba(236,236,236,0.35)', marginRight: Spacing[2], letterSpacing: 1.5 }}>
              FIND_
            </Text>
            <TextInput
              ref={searchInputRef}
              style={{ flex: 1, fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: MAP_NODE, paddingVertical: 0 }}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="topic or keyword..."
              placeholderTextColor="rgba(236,236,236,0.2)"
              autoCapitalize="none"
              returnKeyType="search"
            />
            {hasSearch && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: 'rgba(236,236,236,0.4)' }}>✕</Text>
              </Pressable>
            )}
            {hasSearch && (
              <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: 'rgba(236,236,236,0.3)', marginLeft: Spacing[3] }}>
                {highlightedIds.size}
              </Text>
            )}
          </View>
        )}

        {/* Discover mode: selection count + open-in-companion button */}
        {toolMode === 'discover' && (discoveryNodeIds.length > 0 || discoveryEdgeKeys.length > 0) && !showCapture && !drawerVisible && (
          <View style={[styles.discoveryBar, { bottom: TAB_H + Spacing[5] + FAB_SIZE + Spacing[3] }]} pointerEvents="box-none">
            <View style={[styles.discoveryPill, { backgroundColor: 'rgba(10,10,10,0.9)', borderColor: 'rgba(255,255,255,0.12)' }]} pointerEvents="auto">
              <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.5)' }]}>
                {[
                  discoveryNodeIds.length > 0 && `${discoveryNodeIds.length} ${discoveryNodeIds.length === 1 ? 'point' : 'points'}`,
                  discoveryEdgeKeys.length > 0 && `${discoveryEdgeKeys.length} ${discoveryEdgeKeys.length === 1 ? 'link' : 'links'}`,
                ].filter(Boolean).join(' · ')}
              </Text>
              {discoveryContextIds.size >= 2 && (
                <Pressable
                  onPress={openDiscoveryCompanion}
                  hitSlop={8}
                  style={[styles.discoveryActionBtn, { backgroundColor: 'rgba(126,200,160,0.15)', borderColor: 'rgba(126,200,160,0.32)' }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.discoveryAction, { color: DISCOVERY_ACCENT }]}>
                    open in companion →
                  </Text>
                </Pressable>
              )}
              <Pressable onPress={() => { clearDiscovery(); setToolMode('default'); }} hitSlop={10} style={styles.discoveryClose}>
                <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.35)' }]}>✕</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Quick-save confirmation: the capture is on the map; the insight is
            an offered next step, not a forced screen. Auto-dismisses. */}
        {savedPill && !showCapture && !drawerVisible && (
          <View style={[styles.discoveryBar, { bottom: TAB_H + Spacing[5] + FAB_SIZE + Spacing[3] }]} pointerEvents="box-none">
            <View style={[styles.discoveryPill, { backgroundColor: 'rgba(10,10,10,0.9)', borderColor: 'rgba(255,255,255,0.12)' }]} pointerEvents="auto">
              <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.6)' }]}>saved ✓</Text>
              <Pressable
                onPress={() => { const id = savedPill.id; setSavedPill(null); router.push(`/insight/${id}` as never); }}
                hitSlop={8}
                style={[styles.discoveryActionBtn, { backgroundColor: 'rgba(126,200,160,0.15)', borderColor: 'rgba(126,200,160,0.32)' }]}
                accessibilityRole="button"
                accessibilityLabel="Open the insight for this capture"
              >
                <Text style={[styles.discoveryAction, { color: DISCOVERY_ACCENT }]}>see the insight →</Text>
              </Pressable>
              <Pressable onPress={() => setSavedPill(null)} hitSlop={10} style={styles.discoveryClose}>
                <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.35)' }]}>✕</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* First-load state: map is still fetching, show a clear signal */}
        {graphLoading && nodes.length === 0 && (
          <View style={styles.emptyHint} pointerEvents="none">
            <AsciiLoader
              size={110}
              color="rgba(236,236,236,0.55)"
              message={['drawing your map…', 'plotting your ideas…', 'charting the territory…']}
            />
          </View>
        )}

        {/* Empty state */}
        {isEmpty && (
          <View style={styles.emptyHint} pointerEvents="none">
            <AsciiLoader idle size={100} color="rgba(236,236,236,0.45)" />
            <Text variant="serif" color="muted" style={{ textAlign: 'center', marginBottom: Spacing[3], color: 'rgba(236,236,236,0.4)' }}>
              your map is waiting
            </Text>
            <Text variant="monoSmall" style={{ color: 'rgba(236,236,236,0.25)', textAlign: 'center', lineHeight: 20 }}>
              {'tap + to chart your first thought.'}
            </Text>
          </View>
        )}

        {/* Right-side drawer */}
        {drawerVisible && !showCapture && (
          <>
            <Pressable
              style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
              onPress={closeDrawer}
              accessibilityLabel="Close detail panel"
            />
            <RNAnimated.View
              style={[
                styles.drawer,
                { width: DRAWER_W, backgroundColor: c.background, borderLeftColor: c.border, transform: [{ translateX: drawerX }] },
              ]}
              pointerEvents="auto"
            >
              <ScrollView
                contentContainerStyle={[styles.drawerScroll, { paddingBottom: TAB_H + Spacing[8] }]}
                showsVerticalScrollIndicator={false}
              >
                {/* Close row */}
                <Pressable onPress={closeDrawer} style={styles.drawerClose}>
                  <Text variant="monoSmall" style={{ color: c.muted }}>✕</Text>
                </Pressable>

                {/* Cluster detail */}
                {drawerCluster && !selectedNode && (
                  <View>
                    <View style={styles.drawerClusterHeader}>
                      <Text variant="h2" style={{ flex: 1, marginBottom: Spacing[2] }}>{drawerCluster.name}</Text>
                      <Pressable
                        onPress={() => {
                          setFocusedTopicId((prev) => prev === drawerCluster.topicId ? null : drawerCluster.topicId);
                        }}
                        style={[styles.focusToggle, {
                          borderColor: c.borderSubtle,
                          backgroundColor: focusedTopicId === drawerCluster.topicId ? c.elevated : 'transparent',
                        }]}
                        hitSlop={8}
                      >
                        <Text variant="monoSmall" style={{ color: focusedTopicId === drawerCluster.topicId ? c.text : c.faint }}>
                          {focusedTopicId === drawerCluster.topicId ? 'exit map' : 'open map'}
                        </Text>
                      </Pressable>
                    </View>
                    <Text variant="monoSmall" color="muted" style={{ marginBottom: Spacing[6] }}>
                      {drawerCluster.count} {drawerCluster.count === 1 ? 'capture' : 'captures'}
                    </Text>
                    <View style={[styles.drawerHairline, { backgroundColor: c.border }]} />
                    <Pressable
                      onPress={() => router.push({
                        pathname: '/position/create',
                        params: {
                          topicId: drawerCluster.topicId,
                          topicName: drawerCluster.name,
                          captureCount: drawerCluster.count,
                        },
                      } as never)}
                      style={{ marginTop: Spacing[5] }}
                    >
                      <Text variant="monoSmall" color="muted">take a position →</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => router.push(`/socratic/${drawerCluster.topicId}` as never)}
                      style={{ marginTop: Spacing[4] }}
                    >
                      <Text variant="monoSmall" color="muted">open dialogue →</Text>
                    </Pressable>
                  </View>
                )}

                {/* Node detail */}
                {selectedNode && (
                  <View>
                    <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[3] }}>
                      {selectedNode.kind.toLowerCase()} · {new Date(selectedNode.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {isRecentNode(selectedNode) && ' · new'}
                    </Text>
                    <Text variant="h3" style={{ marginBottom: Spacing[4] }} numberOfLines={4}>
                      {selectedNode.label}
                    </Text>
                    {!!selectedNode.keyIdea && (
                      <>
                        <View style={[styles.drawerHairline, { backgroundColor: c.border }]} />
                        <Text variant="monoSmall" style={{ color: c.muted, fontStyle: 'italic', marginTop: Spacing[3], marginBottom: Spacing[3] }} numberOfLines={3}>
                          {selectedNode.keyIdea}
                        </Text>
                      </>
                    )}
                    {!!selectedNode.reaction && (
                      <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[4] }} numberOfLines={2}>
                        "{selectedNode.reaction}"
                      </Text>
                    )}
                    {selectedNode.topics.length > 0 && (
                      <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[5] }}>
                        {selectedNode.topics.slice(0, 4).map((t) => t.name).join(' · ')}
                      </Text>
                    )}
                    {/* The practice node has no server-side insight to open. */}
                    {selectedNode.id !== TUTORIAL_DEMO_NODE.id && (
                      <Pressable
                        onPress={() => { closeDrawer(); router.push(`/insight/${selectedNode.id}` as never); }}
                        style={{ marginTop: Spacing[2] }}
                      >
                        <Text variant="monoSmall" color="muted">view insight →</Text>
                      </Pressable>
                    )}
                    <Pressable
                      ref={deleteTarget.isActive ? deleteTarget.ref : undefined}
                      onLayout={deleteTarget.isActive ? deleteTarget.onLayout : undefined}
                      onPress={() => handleDeleteNode(selectedNode)}
                      disabled={deletingNode}
                      style={{ marginTop: Spacing[4], flexDirection: 'row', alignItems: 'center', gap: Spacing[2], opacity: deletingNode ? 0.5 : 1 }}
                      accessibilityLabel="Delete this memory"
                    >
                      <Trash2Icon size={13} color={c.danger} />
                      <Text variant="monoSmall" color="danger">
                        {deletingNode ? 'deleting…' : 'delete'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </RNAnimated.View>
          </>
        )}

        {/* FAB — fixed position just above tab bar regardless of active lens */}
        {!showCapture && !drawerVisible && (
          <View style={[styles.fabWrap, { bottom: TAB_H + Spacing[5] }]} pointerEvents="box-none">
            <RNAnimated.View
              style={[styles.fabGlow, { backgroundColor: MAP_NODE, opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
              pointerEvents="none"
            />
            <Pressable
              ref={fabTarget.ref}
              onLayout={fabTarget.onLayout}
              onPress={openCaptureFromFab}
              style={[styles.fab, { backgroundColor: MAP_NODE }]}
              accessibilityLabel="Capture new memory"
              accessibilityRole="button"
            >
              <Text style={[styles.fabPlus, { color: '#060606' }]}>+</Text>
            </Pressable>
          </View>
        )}

        {/* Backdrop for capture modal */}
        {showCapture && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} pointerEvents="none" />
        )}

        {/* Capture modal */}
        {showCapture && (
          <RNAnimated.View
            style={[
              StyleSheet.absoluteFill,
              styles.modal,
              { backgroundColor: c.background, transform: [{ translateY: slideY }] },
            ]}
            pointerEvents="auto"
          >
            <KeyboardAvoidingView
              style={styles.flex}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <ScrollView
                contentContainerStyle={[styles.modalScroll, { paddingBottom: insets.bottom + 48 }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={[styles.dragZone, { paddingTop: insets.top + 14 }]}>
                  <View style={[styles.handle, { backgroundColor: c.border }]} />
                </View>
                <View style={styles.stepRow}>
                  {([1, 2] as const).map((s) => (
                    <React.Fragment key={s}>
                      <View style={[styles.stepDot, { backgroundColor: step >= s ? c.text : 'transparent', borderColor: step >= s ? c.text : c.border }]} />
                      {s < 2 && <View style={[styles.stepLine, { backgroundColor: step > s ? c.text : c.border }]} />}
                    </React.Fragment>
                  ))}
                </View>
                <Text variant="monoSmall" style={[styles.stepLabel, { color: c.muted }]}>
                  {step === 1 ? '01 / CAPTURE' : '02 / REACT'}
                </Text>
                <View style={styles.modalBody}>
                  {step === 1 && (
                    /* Hidden rather than unmounted while a quick save runs,
                       for the same keyboard reasons as step two below. */
                    <View
                      style={busy ? styles.hidden : null}
                      pointerEvents={busy ? 'none' : 'auto'}
                    >
                      <StepOne
                        mode={mode} setMode={setMode}
                        payload={payload} setPayload={setPayload}
                        imageUri={imageUri} uploading={uploading}
                        onPickImage={(source) => void pickImage(source)}
                        error={captureError}
                        onNext={goNext}
                        onClose={closeCapture}
                        onPaste={() => void pasteFromClipboard()}
                        c={c}
                        firstCapture={firstCapturePrompt}
                        onQuickSave={quickSave}
                        busy={busy}
                        clipboardHasUrl={clipboardHasUrl}
                      />
                    </View>
                  )}
                  {busy && (
                    <AsciiLoader
                      size={120}
                      // Staged to mirror the real pipeline (extract → classify/
                      // embed → insight) and hold at the end — no wrap-around
                      // claiming to "read" a source that's already placed.
                      // Timings are estimates from measured capture logs; the
                      // last message explains the slow path (video transcription
                      // and bot-walled articles run 15–25s).
                      message={
                        mode === 'link'
                          ? [
                              'reading the source…',
                              'placing it on your map…',
                              'writing your insight…',
                              'big source — this can take a moment…',
                            ]
                          : [
                              'placing it on your map…',
                              'writing your insight…',
                              'still working…',
                            ]
                      }
                      schedule={mode === 'link' ? [6000, 5000, 6000] : [6000, 7000]}
                    />
                  )}
                  {/* Hidden rather than unmounted while saving: a remount
                      after the save would re-fire the reaction field's
                      autoFocus and flash the keyboard over the closing
                      sheet / the map. */}
                  {step === 2 && (
                    <View
                      style={busy ? styles.hidden : null}
                      pointerEvents={busy ? 'none' : 'auto'}
                    >
                      <StepTwo
                        reaction={reaction} setReaction={setReaction}
                        error={captureError} busy={busy}
                        onBack={() => { setStep(1); setCaptureError(''); }}
                        onCommit={() => void commit()}
                        c={c}
                        isLink={mode === 'link'}
                        preflight={preflight}
                        preflightLoading={preflightLoading}
                        userContext={userContext} setUserContext={setUserContext}
                        onVoiceError={setCaptureError}
                      />
                    </View>
                  )}
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </RNAnimated.View>
        )}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  flex: { flex: 1 },
  hidden: { display: 'none' },
  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[3],
  },
  headerLeft: { flexDirection: 'column', alignItems: 'flex-start' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', paddingTop: 4 },
  lensRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  lensLabel: {
    fontFamily: FontFamily.mono,
    fontSize: 8,
    letterSpacing: 1.5,
  },
  lensDot: {
    fontFamily: FontFamily.mono,
    fontSize: 8,
    color: 'rgba(236,236,236,0.15)',
    marginHorizontal: 5,
  },
  focusBadge: {
    position: 'absolute',
    left: Spacing[6],
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingVertical: 5,
    paddingHorizontal: Spacing[3],
  },
  focusBadgeText: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  searchBar: {
    position: 'absolute',
    left: Spacing[5],
    right: Spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[4],
    paddingVertical: 9,
  },
  discoveryBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  discoveryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingVertical: 6,
    paddingLeft: Spacing[4],
    paddingRight: 6,
    gap: Spacing[3],
  },
  discoveryCount: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1,
  },
  discoveryActionBtn: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingVertical: 6,
    paddingHorizontal: Spacing[3],
  },
  discoveryAction: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    letterSpacing: 0.5,
  },
  discoveryClose: { paddingHorizontal: Spacing[2] },
  emptyHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtn: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawer: {
    position: 'absolute',
    top: 0, bottom: 0, right: 0,
    borderLeftWidth: 1,
  },
  drawerScroll: { paddingHorizontal: Spacing[6], paddingTop: Spacing[8] },
  drawerClose: { alignSelf: 'flex-end', marginBottom: Spacing[6], padding: Spacing[2] },
  drawerHairline: { height: StyleSheet.hairlineWidth, marginVertical: Spacing[4] },
  drawerClusterHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  focusToggle: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: 4,
    paddingHorizontal: Spacing[2],
    marginLeft: Spacing[2],
    marginTop: 2,
  },
  fabWrap: {
    position: 'absolute',
    alignSelf: 'center',
    left: 0, right: 0,
    alignItems: 'center',
  },
  fabGlow: {
    position: 'absolute',
    // Centered on the FAB: the wrap has no explicit height (it sizes to the
    // FAB), so an absolutely-positioned sibling defaults to the same top edge
    // as the FAB — offset it upward by half the size difference to make the
    // two circles concentric instead of the glow bulging out below.
    top: -(FAB_GLOW_SIZE - FAB_SIZE) / 2,
    width: FAB_GLOW_SIZE, height: FAB_GLOW_SIZE,
    borderRadius: FAB_GLOW_SIZE / 2,
  },
  fab: {
    width: FAB_SIZE, height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  fabPlus: {
    fontSize: 30,
    lineHeight: 34,
    fontFamily: FontFamily.sans,
    includeFontPadding: false,
  },
  modal: {
    borderTopLeftRadius: Radius['2xl'],
    borderTopRightRadius: Radius['2xl'],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 24,
  },
  modalScroll: { paddingHorizontal: Spacing[6] },
  dragZone: { alignItems: 'center' },
  handle: { width: 40, height: 4, borderRadius: 2, marginBottom: Spacing[4] },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[2] },
  stepDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1 },
  stepLine: { flex: 1, height: 1, marginHorizontal: Spacing[2] },
  stepLabel: { letterSpacing: 2.2, marginBottom: Spacing[1] },
  modalBody: {},
});
