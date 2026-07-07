import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated as RNAnimated,
  Dimensions,
  Easing,
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
import { Crosshair, Moon, Search, Sun, Trash2Icon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme, useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { LoadingDots } from '@/components/ui/LoadingDots';
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
// Mirrors the global SocraticFab's position (app/(tabs)/_layout.tsx) — it
// floats above the tab bar on the same right edge as the timeline rail, so
// the rail's bottom bound must clear it, not just the tab bar.
const SOCRATIC_FAB_BOTTOM = Platform.OS === 'ios' ? 104 : 86;
const SOCRATIC_FAB_SIZE = 50;

// Always-dark map colors (map is always dark regardless of theme)
const MAP_BG = '#060606';
const MAP_NODE = 'rgba(236,236,236,0.9)';
const MAP_LINE = 'rgba(255,255,255,0.12)';

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

// ── Types ─────────────────────────────────────────────────────────

type LensMode = 'semantic' | 'temporal' | 'source';
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
function layoutSource(nodes: GraphNode[], w: number, h: number): PositionMap {
  const pos: PositionMap = {};
  if (nodes.length === 0) return pos;

  const kinds: CaptureKind[] = ['LINK', 'TEXT', 'QUOTE'];
  const byKind: Record<string, GraphNode[]> = { LINK: [], TEXT: [], QUOTE: [] };
  for (const node of nodes) {
    const bucket = byKind[node.kind] ?? byKind.TEXT;
    bucket.push(node);
  }

  const regions = [
    { cx: w * 0.2, cy: h * 0.5 },
    { cx: w * 0.5, cy: h * 0.5 },
    { cx: w * 0.8, cy: h * 0.5 },
  ];
  const pad = 30;

  kinds.forEach((kind, ki) => {
    const group = byKind[kind] ?? [];
    const { cx, cy } = regions[ki]!;
    const maxR = Math.min(w * 0.14, h * 0.28, 90);

    group.forEach((node, i) => {
      const rng = seededRng(hashId(node.id));
      if (group.length === 1) {
        pos[node.id] = { x: cx, y: cy };
        return;
      }
      const angle = (i / group.length) * Math.PI * 2;
      const r = 24 + rng() * maxR;
      pos[node.id] = {
        x: Math.max(pad, Math.min(w - pad, cx + r * Math.cos(angle))),
        y: Math.max(pad, Math.min(h - pad, cy + r * Math.sin(angle))),
      };
    });
  });

  return pos;
}

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

type CaptureMode = 'link' | 'text' | 'quote' | 'image';

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
  mode, setMode, payload, setPayload, imageUri, uploading, onPickImage, error, onNext, onClose, onPaste, c,
}: {
  mode: CaptureMode; setMode: (m: CaptureMode) => void;
  payload: string; setPayload: (s: string) => void;
  imageUri: string | null; uploading: boolean; onPickImage: (source: 'camera' | 'library') => void;
  error: string; onNext: () => void; onClose: () => void; onPaste: () => void;
  c: AppThemeColors;
}) {
  return (
    <View>
      <Text variant="serifLg" color="primary" style={sh.heading}>What are you saving?</Text>
      <Text variant="monoSmall" color="muted" style={sh.sub}>A link, thought, passage, or image.</Text>
      <Divider c={c} />
      <View style={sh.modeRow}>
        {(['link', 'text', 'quote', 'image'] as CaptureMode[]).map((m) => {
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
      {mode === 'image' ? (
        <View style={[sh.inputBox, { borderColor: c.border }]}>
          <Text variant="monoSmall" style={[sh.inputLabel, { color: c.muted }]}>IMAGE_</Text>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={sh.thumb} contentFit="cover" />
          ) : (
            <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[3] }}>
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
            {mode === 'link' ? 'URL_' : mode === 'quote' ? 'PASSAGE_' : 'THOUGHT_'}
          </Text>
          <TextInput
            style={[sh.inputField, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
            value={payload}
            onChangeText={setPayload}
            placeholder={mode === 'link' ? 'https://...' : mode === 'quote' ? 'a line worth keeping...' : 'fragments are fine.'}
            placeholderTextColor={c.faint}
            multiline={mode !== 'link'}
            autoCapitalize={mode === 'link' ? 'none' : 'sentences'}
            keyboardType={mode === 'link' ? 'url' : 'default'}
            autoFocus
          />
          <Pressable onPress={onPaste} accessibilityLabel="Paste from clipboard">
            <Text variant="monoSmall" style={{ color: c.muted, marginTop: Spacing[3] }}>paste from clipboard ↑</Text>
          </Pressable>
        </View>
      )}
      {!!error && (
        <Text variant="monoSmall" color="danger" style={{ marginTop: Spacing[3] }}>{error}</Text>
      )}
      <Divider c={c} />
      <View style={sh.actions}>
        <Pressable onPress={onClose} style={sh.secondaryBtn}>
          <Text variant="monoSmall" style={{ color: c.muted }}>close ✕</Text>
        </Pressable>
        <Pressable onPress={onNext} style={[sh.primaryBtn, { backgroundColor: c.text }]}>
          <Text variant="monoSmall" style={{ color: c.background }}>next →</Text>
        </Pressable>
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

  return (
    <View>
      <Text variant="serifLg" color="primary" style={sh.heading}>Your reaction.</Text>
      <Text variant="monoSmall" color="muted" style={sh.sub}>Optional. One line, just for you.</Text>
      {isLink && <PreflightStatus loading={preflightLoading} preflight={preflight} c={c} />}
      <Divider c={c} />
      <View style={[sh.inputBox, { borderColor: c.border }]}>
        <Text variant="monoSmall" style={[sh.inputLabel, { color: c.muted }]}>REACTION_</Text>
        <TextInput
          style={[sh.inputField, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
          value={reaction}
          onChangeText={setReaction}
          placeholder="a quick reaction, or nothing."
          placeholderTextColor={c.faint}
          multiline
          autoFocus={!needsContext}
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
        <Pressable onPress={onBack} style={sh.secondaryBtn}>
          <Text variant="monoSmall" style={{ color: c.muted }}>← back</Text>
        </Pressable>
        <Pressable
          onPress={onCommit}
          disabled={busy}
          style={[sh.primaryBtn, { backgroundColor: c.text, opacity: busy ? 0.55 : 1 }]}
        >
          <Text variant="monoSmall" style={{ color: c.background }}>
            {busy ? 'saving...' : 'commit →'}
          </Text>
        </Pressable>
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
  secondaryBtn: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[2] },
  primaryBtn: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[5], borderRadius: Radius.xs },
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
  const tools: { id: Exclude<ToolMode, 'default'>; label: string; Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }> }[] = [
    { id: 'discover', label: 'Discover connections', Icon: Crosshair },
    { id: 'search', label: 'Find on map', Icon: Search },
  ];

  const recenterVisible = !!onRecenter && showRecenter !== false;

  return (
    <View style={[tb.pill, { backgroundColor: 'rgba(10,10,10,0.72)', borderColor: 'rgba(255,255,255,0.12)' }]}>
      {recenterVisible && (
        <>
          <Pressable
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
        return (
          <React.Fragment key={tool.id}>
            {i > 0 && <View style={[tb.sep, { backgroundColor: 'rgba(255,255,255,0.08)' }]} />}
            <Pressable
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
  top, pointCount, topicCount, connectionCount, tensionCount, exciting, onNavigate,
}: {
  top: number;
  pointCount: number;
  topicCount: number;
  connectionCount: number;
  tensionCount: number;
  exciting: ExcitingLine | null;
  onNavigate: (route: string) => void;
}) {
  return (
    <View style={[infoPanelStyles.wrap, { top }]} pointerEvents="box-none">
      <Text variant="monoSmall" style={infoPanelStyles.line}>
        {pointCount} {pointCount === 1 ? 'point' : 'points'}
      </Text>
      <Text variant="monoSmall" style={infoPanelStyles.line}>
        {topicCount} {topicCount === 1 ? 'topic' : 'topics'}
      </Text>
      {connectionCount > 0 && (
        <Text variant="monoSmall" style={infoPanelStyles.line}>
          {connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}
        </Text>
      )}
      {tensionCount > 0 && (
        <Pressable onPress={() => onNavigate('/(tabs)/mind')} hitSlop={6}>
          <Text variant="monoSmall" style={infoPanelStyles.exciting}>
            {tensionCount} {tensionCount === 1 ? 'tension' : 'tensions'} to explore →
          </Text>
        </Pressable>
      )}
      {exciting && (
        <Pressable onPress={() => onNavigate(exciting.route)} hitSlop={6}>
          <Text variant="monoSmall" style={infoPanelStyles.exciting}>{exciting.text}</Text>
        </Pressable>
      )}
    </View>
  );
}

const infoPanelStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing[6],
    alignItems: 'flex-end',
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

// Incremental date marks along the rail. The unit widens with elapsed time:
// days for a short history, then weeks, then months.
function buildTimelineTicks(startMs: number, endMs: number): {
  ticks: TimelineTick[];
  unit: 'day' | 'week' | 'month';
} {
  const span = Math.max(endMs - startMs, 1);
  const pctOf = (ts: number) => (ts - startMs) / span;
  const fmtDay = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtMonth = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

  const ticks: TimelineTick[] = [];
  let unit: 'day' | 'week' | 'month';

  if (span <= 21 * DAY_MS) {
    unit = 'day';
    const d = new Date(startMs); d.setHours(0, 0, 0, 0);
    for (let t = d.getTime(); t <= endMs; t += DAY_MS) {
      if (t >= startMs) ticks.push({ pct: pctOf(t), label: fmtDay(t), labelled: false });
    }
  } else if (span <= 120 * DAY_MS) {
    unit = 'week';
    for (let t = startMs; t <= endMs; t += 7 * DAY_MS) {
      ticks.push({ pct: pctOf(t), label: fmtDay(t), labelled: false });
    }
  } else {
    unit = 'month';
    const d = new Date(startMs); d.setDate(1); d.setHours(0, 0, 0, 0);
    while (d.getTime() < startMs) d.setMonth(d.getMonth() + 1);
    for (; d.getTime() <= endMs; d.setMonth(d.getMonth() + 1)) {
      ticks.push({ pct: pctOf(d.getTime()), label: fmtMonth(d.getTime()), labelled: false });
    }
  }

  // The last generated mark always lands on (or a sliver before) today, which
  // duplicates the fixed "current date" endpoint below — drop it so "now"
  // only ever appears once, anchored at the end of the rail.
  if (ticks.length > 0) ticks.pop();

  // Label a subset (≈4 interior marks) so the narrow rail doesn't crowd. The
  // endpoints get their own explicit labels, so skip marks near the ends.
  const stride = Math.max(1, Math.ceil(ticks.length / 5));
  ticks.forEach((tk, i) => {
    tk.labelled = i % stride === 0 && tk.pct > 0.06 && tk.pct < 0.94;
  });

  return { ticks, unit };
}

function TimelineScrubber({ startMs, endMs, pct, onChange, top, railH }: TimelineScrubberProps) {
  const pctRef = useRef(pct);
  pctRef.current = pct;
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

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Tap-to-jump: land the thumb wherever the rail is touched.
      onPanResponderGrant: (evt) => {
        const y = evt.nativeEvent.locationY;
        const newPct = Math.max(0, Math.min(1, y / railHRef.current));
        pctRef.current = newPct;
        onChange(newPct);
      },
      // Scrub: the thumb follows the finger.
      onPanResponderMove: (evt, gs) => {
        const startY = pctRef.current * railHRef.current;
        const newY = startY + gs.dy;
        const newPct = Math.max(0, Math.min(1, newY / railHRef.current));
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
  );

  useFocusEffect(useCallback(() => { void refetchGraph(); }, [refetchGraph]));

  // Account creation date anchors the temporal timeline's start.
  const { data: profileData } = useApiQuery(() => api.profile.me(), []);
  const accountCreatedMs = useMemo(() => {
    const created = profileData?.profile.createdAt;
    return created ? new Date(created).getTime() : null;
  }, [profileData]);

  // Info panel: independent, non-blocking fetches — each line appears as
  // soon as its own data resolves, without gating on the others.
  const { data: intelligenceData } = useApiQuery(() => api.memory.intelligence(), []);
  const { data: trendsData } = useApiQuery(() => api.memory.trends({ window: 'week' }), []);
  const { data: pulseData } = useApiQuery(() => api.social.pulse(), []);

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const clusters = graphData?.clusters ?? [];

  const topicCount = useMemo(() => {
    const ids = new Set<string>();
    for (const n of nodes) for (const t of n.topics) ids.add(t.topicId);
    return ids.size;
  }, [nodes]);

  const tensionCount = intelligenceData?.contradictionCards.length ?? 0;

  const excitingLine = useMemo((): ExcitingLine | null => {
    const friendWithRecent = pulseData?.friends.find((f) => {
      const latest = f.latest[0];
      return latest && Date.now() - new Date(latest.capturedAt).getTime() < DAY_MS;
    });
    if (friendWithRecent) {
      return { text: `${friendWithRecent.user.displayName} just added something →`, route: '/(tabs)/pulse' };
    }
    const risingTheme = trendsData?.shifts
      .filter((s) => s.delta > 0)
      .sort((a, b) => b.delta - a.delta)[0];
    if (risingTheme) {
      return { text: `${risingTheme.name} is rising this week →`, route: '/(tabs)/trends' };
    }
    return null;
  }, [pulseData, trendsData]);

  // ── Lens mode ──────────────────────────────────────────────────
  const [lensMode, setLensMode] = useState<LensMode>('semantic');
  // True while nodes are easing between layouts, so per-lens labels can stay
  // hidden until the map has settled (otherwise they float over moving nodes).
  const [lensTransitioning, setLensTransitioning] = useState(false);

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
  const sourcePos = useMemo(
    () => applyLayoutOffset(layoutSource(nodes, LAYOUT_W, LAYOUT_H)),
    [nodes],
  );

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

    const targetPos = lensMode === 'semantic' ? semanticPos
      : lensMode === 'temporal' ? temporalPos
      : sourcePos;

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

    const targetPos = newLens === 'semantic' ? semanticPos
      : newLens === 'temporal' ? temporalPos
      : sourcePos;

    setLensMode(newLens);

    if (Object.keys(renderPosRef.current).length === 0) {
      renderPosRef.current = targetPos;
      setRenderPos(targetPos);
      const fit = computeCameraFit(nodes, targetPos);
      if (fit) {
        savedVB.current = { x: fit.x, y: fit.y };
        savedZoom.current = fit.zoom;
        setVbPos({ x: fit.x, y: fit.y });
        setZoom(fit.zoom);
      }
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
      const fit = computeCameraFit(nodes, newPos);
      if (fit) {
        savedVB.current = { x: fit.x, y: fit.y };
        savedZoom.current = fit.zoom;
        setVbPos({ x: fit.x, y: fit.y });
        setZoom(fit.zoom);
      }

      if (t < 1) requestAnimationFrame(tick);
      else setLensTransitioning(false);
    };

    requestAnimationFrame(tick);
    lensAnimCancelRef.current = () => { cancelled = true; setLensTransitioning(false); };
  }, [lensMode, semanticPos, temporalPos, sourcePos, nodes]);

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

  // Precompute per-node radius + base opacity (each node's RNG constructed once)
  const nodeMetrics = useMemo(() => {
    const m = new Map<string, { r: number; baseOpacity: number }>();
    for (const node of nodes) {
      const rng = seededRng(hashId(node.id));
      const base = 2.2 + rng() * 1.8;
      const deg = Math.min(edgeCounts[node.id] ?? 0, 8);
      m.set(node.id, { r: base + deg * 0.45, baseOpacity: 0.65 + rng() * 0.35 });
    }
    return m;
  }, [nodes, edgeCounts]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const isRecentNode = useCallback(
    (node: GraphNode): boolean => Date.now() - new Date(node.capturedAt).getTime() < RECENT_MS,
    [], // stable: RECENT_MS is a module constant, date.now() difference only matters per-session
  );

  // ── Tool state ─────────────────────────────────────────────────
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

  const toggleDiscoveryNode = useCallback((nodeId: string) => {
    setDiscoveryNodeIds((prev) => {
      if (prev.includes(nodeId)) return prev.filter((id) => id !== nodeId);
      if (prev.length >= 5) return [...prev.slice(1), nodeId];
      return [...prev, nodeId];
    });
  }, []);

  const clearDiscovery = useCallback(() => {
    setDiscoveryNodeIds([]);
  }, []);

  const openDiscoveryCompanion = useCallback(() => {
    if (discoveryNodeIds.length < 2) return;
    const labels = discoveryNodeIds
      .map((id) => nodes.find((n) => n.id === id)?.label ?? '')
      .filter(Boolean)
      .map((l) => l.replace(/,/g, ';'));
    router.push({
      pathname: '/companion' as never,
      params: { contextIds: discoveryNodeIds.join(','), contextLabels: labels.join(',') },
    });
    clearDiscovery();
    setToolMode('default');
  }, [discoveryNodeIds, nodes, router, clearDiscovery]);

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
    if (nodes.length === 0) return Infinity;
    return timeRange.startMs + (timeRange.endMs - timeRange.startMs) * timelinePct;
  }, [nodes.length, timeRange, timelinePct]);

  // ── Focus mode ────────────────────────────────────────────────
  const [focusedTopicId, setFocusedTopicId] = useState<string | null>(null);

  // ── Viewport: pan + zoom ──────────────────────────────────────
  const savedVB = useRef({ x: INIT_VB_X, y: INIT_VB_Y });
  const [vbPos, setVbPos] = useState({ x: INIT_VB_X, y: INIT_VB_Y });

  const savedZoom = useRef(0.4);
  const [zoom, setZoom] = useState(0.4);

  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  const resetView = useCallback(() => {
    savedVB.current = { x: INIT_VB_X, y: INIT_VB_Y };
    savedZoom.current = 0.4;
    setVbPos({ x: INIT_VB_X, y: INIT_VB_Y });
    setZoom(0.4);
  }, []);

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
      setVbPos({ x: cx, y: cy });
      setZoom(z);
      if (t < 1) frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    animCancelRef.current = () => { cancelled = true; cancelAnimationFrame(frameId); };
  }, []);

  const centerOnNodes = useCallback((posOverride?: PositionMap, animated = false, animDuration = 720) => {
    const positions = posOverride ?? pos;
    const fit = computeCameraFit(nodes, positions);
    if (!fit) { resetView(); return; }

    if (animated) {
      animateCamera(fit.x, fit.y, fit.zoom, animDuration);
    } else {
      savedVB.current = { x: fit.x, y: fit.y };
      savedZoom.current = fit.zoom;
      setVbPos({ x: fit.x, y: fit.y });
      setZoom(fit.zoom);
    }
  }, [nodes, pos, resetView, animateCamera]);

  // Auto-recenter on first data load
  const hasInitiallyLoadedRef = useRef(false);
  useEffect(() => {
    if (nodes.length === 0 || hasInitiallyLoadedRef.current) return;
    hasInitiallyLoadedRef.current = true;
    centerOnNodes(semanticPos);
  }, [nodes.length, semanticPos, centerOnNodes]);

  // Auto-recenter when the Atlas tab gains focus
  useFocusEffect(useCallback(() => {
    if (nodes.length > 0) centerOnNodes();
  }, [nodes.length, centerOnNodes]));

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
        // Cancel any in-flight momentum
        if (momentumFrameRef.current !== null) {
          cancelAnimationFrame(momentumFrameRef.current);
          momentumFrameRef.current = null;
        }
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
          setZoom(newZoom);
          setVbPos({ x: nx, y: ny });
          return;
        }
        // Pan
        const vbW = SW / savedZoom.current;
        const vbH = SH / savedZoom.current;
        const nx = clampVBX(savedVB.current.x - gs.dx / savedZoom.current, vbW);
        const ny = clampVBY(savedVB.current.y - gs.dy / savedZoom.current, vbH);
        setVbPos({ x: nx, y: ny });
        // Track velocity for momentum
        const now = Date.now();
        lastMoveRef.current = { x: gs.vx, y: gs.vy, t: now };
      },

      onPanResponderRelease: (evt, gs) => {
        if (pinchStartRef.current) {
          pinchStartRef.current = null;
          return;
        }
        // Commit final pan position
        const vbW = SW / savedZoom.current;
        const vbH = SH / savedZoom.current;
        const nx = clampVBX(savedVB.current.x - gs.dx / savedZoom.current, vbW);
        const ny = clampVBY(savedVB.current.y - gs.dy / savedZoom.current, vbH);
        savedVB.current = { x: nx, y: ny };
        setVbPos({ x: nx, y: ny });

        // Momentum scroll — decay velocity over ~400ms
        const vx = gs.vx * 0.6;
        const vy = gs.vy * 0.6;
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < 0.3) return;

        let velX = vx;
        let velY = vy;
        const decay = 0.88;
        const MIN_VEL = 0.05;

        const step = () => {
          velX *= decay;
          velY *= decay;
          if (Math.abs(velX) < MIN_VEL && Math.abs(velY) < MIN_VEL) {
            momentumFrameRef.current = null;
            return;
          }
          const z = savedZoom.current;
          const w = SW / z;
          const h = SH / z;
          const mx = clampVBX(savedVB.current.x - velX * 12 / z, w);
          const my = clampVBY(savedVB.current.y - velY * 12 / z, h);
          savedVB.current = { x: mx, y: my };
          setVbPos({ x: mx, y: my });
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
            setDeletingNode(true);
            try {
              await api.captures.delete(node.id);
              closeDrawer();
              await refetchGraph();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setDeletingNode(false);
            }
          },
        },
      ],
    );
  }, [closeDrawer, refetchGraph]);

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

  const runPreflight = useCallback((url: string) => {
    const seq = ++preflightSeq.current;
    setPreflight(null);
    setPreflightLoading(true);
    api.captures
      .preflight(url)
      // A failed preflight means the scrape failed — treat it as unreadable.
      .catch((): CapturePreflight => ({ confidence: 'thin' }))
      .then((res) => {
        if (preflightSeq.current !== seq) return;
        setPreflight(res);
        setPreflightLoading(false);
      });
  }, []);
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

  const openCapture = useCallback(() => {
    closeDrawer();
    setSelectedNode(null);
    setStep(1); setPayload(''); setReaction('');
    setImageUri(null); setMediaUrl(null); setUploading(false);
    setCaptureError(''); setMode('link');
    setPreflight(null); setPreflightLoading(false); setUserContext('');
    setShowCapture(true);
    slideY.setValue(SH);
    RNAnimated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 170 }).start();
  }, [closeDrawer, slideY]);

  const closeCapture = useCallback(() => {
    RNAnimated.timing(slideY, { toValue: SH, duration: 260, useNativeDriver: true }).start(() => {
      setShowCapture(false);
    });
  }, [slideY]);

  const goNext = useCallback(() => {
    if (mode === 'image') {
      if (uploading) { setCaptureError('Still reading the image…'); return; }
      if (!mediaUrl) { setCaptureError('Add an image first.'); return; }
    } else if (!payload.trim()) {
      setCaptureError('Enter a URL or thought first.'); return;
    }
    if (mode === 'link') {
      runPreflight(normalizeLinkInput(payload));
    }
    setCaptureError(''); setStep(2);
  }, [mode, payload, mediaUrl, uploading, runPreflight]);

  // Content shared in from the OS share sheet arrives as route params. Rather
  // than saving silently, seed the capture flow and drop the user on the
  // reaction step so every capture goes through the same flow.
  const shareParams = useLocalSearchParams<{
    shareKind?: string; shareUrl?: string; shareText?: string; shareMediaUrl?: string;
  }>();
  useEffect(() => {
    const kind = shareParams.shareKind;
    if (!kind) return;
    closeDrawer();
    setSelectedNode(null);
    setCaptureError('');
    setReaction('');
    setPreflight(null); setPreflightLoading(false); setUserContext('');
    if (kind === 'LINK') {
      setMode('link'); setPayload(String(shareParams.shareUrl ?? ''));
      setImageUri(null); setMediaUrl(null);
      const sharedUrl = String(shareParams.shareUrl ?? '').trim();
      if (sharedUrl) runPreflight(normalizeLinkInput(sharedUrl));
    } else if (kind === 'IMAGE') {
      setMode('image');
      setMediaUrl(String(shareParams.shareMediaUrl ?? ''));
      setImageUri(String(shareParams.shareMediaUrl ?? ''));
      setPayload('');
    } else {
      setMode('text'); setPayload(String(shareParams.shareText ?? ''));
      setImageUri(null); setMediaUrl(null);
    }
    setStep(2);
    setShowCapture(true);
    slideY.setValue(SH);
    RNAnimated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 170 }).start();
    // Clear params so returning to this tab doesn't reopen the sheet.
    router.setParams({ shareKind: '', shareUrl: '', shareText: '', shareMediaUrl: '' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareParams.shareKind, shareParams.shareUrl, shareParams.shareText, shareParams.shareMediaUrl]);

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

  const commit = useCallback(async () => {
    setBusy(true); setCaptureError('');
    try {
      let kind: CaptureKind = 'TEXT';
      let url: string | undefined;
      let text: string | undefined;
      if (mode === 'link') { kind = 'LINK'; url = normalizeLinkInput(payload); }
      else if (mode === 'quote') { kind = 'QUOTE'; text = payload.trim(); }
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
      void refetchGraph();
      closeCapture();
      router.push(`/insight/${res.id}` as never);
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      setBusy(false);
    }
  }, [mode, payload, mediaUrl, reaction, userContext, refetchGraph, closeCapture, router]);

  const pasteFromClipboard = useCallback(async () => {
    const t = (await Clipboard.getStringAsync()).trim();
    if (!t) return;
    setPayload(t);
    if (/^https?:\/\//i.test(t)) setMode('link');
  }, []);

  const glowOpacity = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.22] });
  const glowScale = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] });
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
    if (!newNodeId || !pos[newNodeId] || animatingRef.current) return;
    animatingRef.current = true;
    landingAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(landingAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      RNAnimated.timing(landingAnim, { toValue: 0, duration: 750, useNativeDriver: true }),
    ]).start(() => { animatingRef.current = false; setNewNodeId(null); });
  }, [newNodeId, pos, landingAnim]);

  const nodeColor = useCallback((node: GraphNode): string => {
    const clusterColor = node.topics.reduce<string | undefined>(
      (acc, t) => acc ?? clusterColorMap.get(t.topicId),
      undefined,
    );
    if (clusterColor) return clusterColor;
    return isRecentNode(node) ? '#D4B896' : MAP_NODE;
  }, [clusterColorMap, isRecentNode]);

  const vbW = SW / zoom;
  const vbH = SH / zoom;

  // The background (dot grid + tone) must always cover the viewport so the
  // canvas edge is never visible — even zoomed all the way out, where the
  // viewport can be larger than the canvas. Anchor a rect 3× the viewport,
  // centred on it, so it fills the screen at any pan/zoom.
  const bgX = vbPos.x - vbW;
  const bgY = vbPos.y - vbH;
  const bgW = vbW * 3;
  const bgH = vbH * 3;

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

  // Source kind labels for source lens mode. Held back until the lens
  // transition settles so "links / thoughts / quotes" don't flash over nodes
  // that are still sliding into their groups.
  const kindLabels = lensMode === 'source' && !lensTransitioning ? [
    { kind: 'LINK' as CaptureKind, label: 'links', x: MAP_PAD + LAYOUT_W * 0.2, y: MAP_PAD + LAYOUT_H * 0.15 },
    { kind: 'TEXT' as CaptureKind, label: 'thoughts', x: MAP_PAD + LAYOUT_W * 0.5, y: MAP_PAD + LAYOUT_H * 0.15 },
    { kind: 'QUOTE' as CaptureKind, label: 'quotes', x: MAP_PAD + LAYOUT_W * 0.8, y: MAP_PAD + LAYOUT_H * 0.15 },
  ] : [];

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
    // Focus dimming
    if (focusedTopicId && !node.topics.some((t) => t.topicId === focusedTopicId)) {
      return baseOpacity * 0.06 * zoomFade;
    }
    return baseOpacity * zoomFade;
  }, [hasSearch, highlightedIds, lensMode, nodeTimestamps, timelineCutoffMs, focusedTopicId]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: mapBg }]}>

      {/* Static background dot grid */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SW} height={SH} style={StyleSheet.absoluteFill}>
          <Defs>
            <Pattern id="staticDotGrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <Circle cx="16" cy="16" r="0.9" fill={MAP_NODE} fillOpacity={0.04} />
            </Pattern>
          </Defs>
          <Rect x="0" y="0" width={SW} height={SH} fill="url(#staticDotGrid)" />
        </Svg>
      </View>

      {/* Pannable map canvas */}
      <View style={StyleSheet.absoluteFill}>
        <View style={StyleSheet.absoluteFill} {...mapPan.panHandlers}>

          <Svg
            width={SW}
            height={SH}
            viewBox={`${vbPos.x} ${vbPos.y} ${vbW} ${vbH}`}
            style={StyleSheet.absoluteFill}
          >
            <Defs>
              <Pattern id="dotGrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
                <Circle cx="16" cy="16" r="0.9" fill={MAP_NODE} fillOpacity={0.04} />
              </Pattern>
              <RadialGradient id="ambientGlow" cx="50%" cy="44%" r="48%" fx="50%" fy="44%">
                <Stop offset="0%" stopColor={MAP_NODE} stopOpacity={0.06} />
                <Stop offset="100%" stopColor={MAP_NODE} stopOpacity={0} />
              </RadialGradient>
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
              <LinearGradient id="bgTone" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={MAP_NODE} stopOpacity={0.012} />
                <Stop offset="100%" stopColor={MAP_NODE} stopOpacity={0.03} />
              </LinearGradient>
            </Defs>

            <G>
              <Rect x={bgX} y={bgY} width={bgW} height={bgH} fill="url(#dotGrid)" />
              <Rect x={bgX} y={bgY} width={bgW} height={bgH} fill="url(#bgTone)" />
              {/* Ambient glow stays anchored to the canvas — it fades to zero
                  well within its bounds, so it never draws a hard edge. */}
              <Rect width={CANVAS_W} height={CANVAS_H} fill="url(#ambientGlow)" />

              {/* Cluster region halos — only in semantic mode */}
              {lensMode === 'semantic' && clusterLabels.map((cl) => {
                const clusterR = Math.min(LAYOUT_W, LAYOUT_H) * 0.16;
                const dimmed = focusedTopicId && cl.topicId !== focusedTopicId;
                return (
                  <Circle
                    key={`cl-area-${cl.topicId}`}
                    cx={cl.x} cy={cl.y} r={clusterR}
                    fill={`url(#clGrad-${cl.topicId})`}
                    fillOpacity={dimmed ? 0.2 : 1}
                  />
                );
              })}

              {/* Cluster labels (semantic mode only) — hierarchical: coarse
                  domain labels own the zoomed-out view; the more specific
                  topic labels fade in as the user zooms into their region. */}
              {lensMode === 'semantic' && clusterLabels.map((cl) => {
                const isDomain = cl.kind === 'domain';
                const clFontSize = isDomain
                  ? Math.max(9, Math.min(22, 14 / zoom))
                  : Math.max(7, Math.min(14, 10 / zoom));
                const clOpacity = isDomain
                  ? (zoom <= 1.0
                    ? 0.12 + (1 - zoom) * 0.10
                    : Math.max(0, 0.12 * (1 - (zoom - 1.0) / 0.6)))
                  : (zoom <= 1.1
                    ? 0
                    : Math.min(0.20, ((zoom - 1.1) / 0.5) * 0.20));
                if (clOpacity <= 0.005) return null;
                const dimmed = focusedTopicId && cl.topicId !== focusedTopicId;
                return (
                  <SvgText
                    key={`cl-label-${cl.topicId}`}
                    x={cl.x} y={cl.y}
                    fontSize={clFontSize}
                    fontFamily={FontFamily.mono}
                    fill="rgba(236,236,236,1)"
                    fillOpacity={dimmed ? Math.min(0.05, clOpacity) : Math.min(0.28, clOpacity)}
                    textAnchor="middle"
                    letterSpacing={3.5}
                  >
                    {cl.name.toUpperCase()}
                  </SvgText>
                );
              })}

              {/* Source kind labels */}
              {kindLabels.map((kl) => {
                const fontSize = Math.max(10, Math.min(20, 13 / zoom));
                return (
                  <SvgText
                    key={`kl-${kl.kind}`}
                    x={kl.x} y={kl.y}
                    fontSize={fontSize}
                    fontFamily={FontFamily.mono}
                    fill="rgba(236,236,236,1)"
                    fillOpacity={0.18}
                    textAnchor="middle"
                    letterSpacing={3}
                  >
                    {kl.label.toUpperCase()}
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

              {/* Edges */}
              {edges.map((e, i) => {
                const a = pos[e.fromItemId];
                const b = pos[e.toItemId];
                if (!a || !b) return null;

                const baseOpacity = 0.07 + e.weight * 0.24;
                let edgeOpacity = baseOpacity;
                if (focusedTopicId) {
                  const fromNode = nodeById.get(e.fromItemId);
                  const toNode = nodeById.get(e.toItemId);
                  const fromInFocus = fromNode?.topics.some((t) => t.topicId === focusedTopicId);
                  const toInFocus = toNode?.topics.some((t) => t.topicId === focusedTopicId);
                  if (!fromInFocus && !toInFocus) edgeOpacity *= 0.08;
                }

                return (
                  <Line
                    key={`e${i}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={MAP_LINE}
                    strokeWidth={0.7}
                    strokeOpacity={edgeOpacity}
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

                // Nodes stay visible at every zoom level — never fade to zero.
                // Only a gentle dimming as you pull back, floored so points (and
                // their colour) remain clearly readable when fully zoomed out.
                const zoomFade = Math.max(0.6, Math.min(1, (zoom - 0.15) / 0.75));
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
            </G>
          </Svg>

          {/* Node touch targets — always active; PanResponder steals drag gestures */}
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents="box-none"
          >
            {nodes.map((node) => {
              const p = pos[node.id];
              if (!p) return null;
              const screenX = (p.x - vbPos.x) * zoom;
              const screenY = (p.y - vbPos.y) * zoom;
              const HIT = 38;
              if (screenX < -HIT || screenX > SW + HIT || screenY < -HIT || screenY > SH + HIT) return null;
              return (
                <Pressable
                  key={node.id}
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
                    }
                  }}
                  accessibilityLabel={node.label}
                  accessibilityRole="button"
                />
              );
            })}
            {/* Cluster label touch targets (semantic mode only) */}
            {lensMode === 'semantic' && clusterLabels.map((cl) => {
              const screenX = (cl.x - vbPos.x) * zoom;
              const screenY = (cl.y - vbPos.y) * zoom;
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

        </View>

        {/* New node landing animation */}
        {landingRing}

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
              </View>
              {/* Lens picker */}
              <View style={styles.lensRow} pointerEvents="box-none">
                {(['semantic', 'temporal', 'source'] as LensMode[]).map((l, i) => {
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
                showRecenter={nodes.length > 0 && !showCapture}
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
          body="Your knowledge map. Every node is something you saved. Lines appear when ideas share a topic, contradict each other, or grow out of one another. Switch lenses to sort the map by meaning, time, or source."
        />

        {/* Info panel (top-right map summary) */}
        {nodes.length > 0 && !showCapture && !drawerVisible && lensMode !== 'temporal' &&
          toolMode !== 'search' && !(toolMode === 'discover' && discoveryNodeIds.length > 0) && (
          <InfoPanel
            top={insets.top + 80}
            pointCount={nodes.length}
            topicCount={topicCount}
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
        {toolMode === 'discover' && discoveryNodeIds.length > 0 && !showCapture && !drawerVisible && (
          <View style={[styles.discoveryBar, { bottom: TAB_H + Spacing[5] + FAB_SIZE + Spacing[3] }]} pointerEvents="box-none">
            <View style={[styles.discoveryPill, { backgroundColor: 'rgba(10,10,10,0.88)', borderColor: 'rgba(255,255,255,0.12)' }]} pointerEvents="auto">
              <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.5)' }]}>
                {discoveryNodeIds.length} selected
              </Text>
              {discoveryNodeIds.length >= 2 && (
                <>
                  <View style={[styles.discoverySep, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
                  <Pressable onPress={openDiscoveryCompanion} hitSlop={8}>
                    <Text style={[styles.discoveryAction, { color: '#7EC8A0' }]}>
                      open in companion →
                    </Text>
                  </Pressable>
                </>
              )}
              <View style={[styles.discoverySep, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
              <Pressable onPress={() => { clearDiscovery(); setToolMode('default'); }} hitSlop={8}>
                <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.3)' }]}>✕</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* First-load state: map is still fetching, show a clear signal */}
        {graphLoading && nodes.length === 0 && (
          <View style={styles.emptyHint} pointerEvents="none">
            <LoadingDots size={6} color="rgba(236,236,236,0.4)" />
            <Text variant="monoSmall" style={{ color: 'rgba(236,236,236,0.28)', textAlign: 'center', marginTop: Spacing[5], letterSpacing: 1 }}>
              drawing your map
            </Text>
          </View>
        )}

        {/* Empty state */}
        {isEmpty && (
          <View style={styles.emptyHint} pointerEvents="none">
            <Text variant="monoSmall" style={{ color: 'rgba(236,236,236,0.2)', textAlign: 'center', letterSpacing: 4, marginBottom: Spacing[5] }}>
              · · ·
            </Text>
            <Text variant="serif" color="muted" style={{ textAlign: 'center', marginBottom: Spacing[3], color: 'rgba(236,236,236,0.35)' }}>
              nothing on the map yet
            </Text>
            <Text variant="monoSmall" style={{ color: 'rgba(236,236,236,0.2)', textAlign: 'center', lineHeight: 20 }}>
              {'Tap the + below to save your\nfirst thing and watch it appear.'}
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
                          {focusedTopicId === drawerCluster.topicId ? 'focused' : 'focus'}
                        </Text>
                      </Pressable>
                    </View>
                    <Text variant="monoSmall" color="muted" style={{ marginBottom: Spacing[6] }}>
                      {drawerCluster.count} {drawerCluster.count === 1 ? 'capture' : 'captures'}
                    </Text>
                    <View style={[styles.drawerHairline, { backgroundColor: c.border }]} />
                    <Pressable
                      onPress={() => router.push(`/position/${drawerCluster.topicId}` as never)}
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
                    <Pressable
                      onPress={() => { closeDrawer(); router.push(`/insight/${selectedNode.id}` as never); }}
                      style={{ marginTop: Spacing[2] }}
                    >
                      <Text variant="monoSmall" color="muted">view insight →</Text>
                    </Pressable>
                    <Pressable
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
              onPress={openCapture}
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
                    />
                  )}
                  {step === 2 && (
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
    paddingVertical: 8,
    paddingHorizontal: Spacing[4],
    gap: Spacing[3],
  },
  discoveryCount: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1,
  },
  discoveryAction: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1,
  },
  discoverySep: { width: 1, height: 14 },
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
    width: FAB_SIZE * 1.6, height: FAB_SIZE * 1.6,
    borderRadius: (FAB_SIZE * 1.6) / 2,
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
