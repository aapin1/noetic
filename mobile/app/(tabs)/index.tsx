import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Dimensions,
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
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
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
import { Hand, MousePointer2, Search } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing, darkColors } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { AppThemeColors } from '@/constants/theme';
import type { CaptureKind, CaptureResponse, MemoryEdgeType, MemoryGraphResponse, Recommendation } from '@/types/api';

type GraphNode = MemoryGraphResponse['nodes'][number];

const { width: SW, height: SH } = Dimensions.get('window');
const TAB_H = Platform.OS === 'ios' ? 86 : 68;
const FAB_SIZE = 64;

// Layout area — nodes are distributed within this space
const LAYOUT_W = SW * 2.2;
const LAYOUT_H = SH * 2.0;

// Extra pannable padding around the layout area
const MAP_PAD = SW * 1.4;

// Total canvas — much larger than the layout area so there's always free space to pan into
const CANVAS_W = LAYOUT_W + MAP_PAD * 2;
const CANVAS_H = LAYOUT_H + MAP_PAD * 2;

// Initial view centers on the layout area center
const INIT_VB_X = MAP_PAD + (LAYOUT_W - SW) / 2;
const INIT_VB_Y = MAP_PAD + (LAYOUT_H - SH) / 2;

const ZOOM_MIN = 0.22;
const ZOOM_MAX = 5.0;

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

// ── Layout helpers ──────────────────────────────────────────────

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

// Edge attraction factors — how strongly connected nodes pull toward each other
const EDGE_PULL: Record<string, number> = {
  RECURS: 0.42,
  REINFORCES: 0.30,
  CONTRADICTS: -0.12, // slight repulsion keeps contradictions visually apart
  EVOLVES_FROM: 0.22,
  RELATED: 0.14,
};

function layoutGraph(
  nodes: MemoryGraphResponse['nodes'],
  clusters: MemoryGraphResponse['clusters'],
  edges: MemoryGraphResponse['edges'],
  w: number,
  h: number,
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return pos;

  const cx = w / 2;
  const cy = h * 0.44;
  const pad = 30;

  const majorClusters = clusters.filter((cl) => cl.count >= MAJOR_CLUSTER_MIN);

  // ── Initial placement ─────────────────────────────────────────
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
    const topicToCentre = new Map<string, { x: number; y: number }>(Object.entries(centres));
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

  // ── Force-directed settle ─────────────────────────────────────
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

    // Repulsion — all pairs push apart
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

    // Edge attraction
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

    // Topic bonding — shared topic attracts even without explicit edge
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

    // Apply with damping and clamping
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

function applyLayoutOffset(
  raw: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  for (const [id, p] of Object.entries(raw)) {
    result[id] = { x: p.x + MAP_PAD, y: p.y + MAP_PAD };
  }
  return result;
}

function clusterLabelPositions(
  clusters: MemoryGraphResponse['clusters'],
  w: number,
  h: number,
) {
  const major = clusters.filter((cl) => cl.count >= MAJOR_CLUSTER_MIN);
  if (major.length === 0) return [];
  const cx = w / 2;
  const cy = h * 0.44;
  const cr = Math.min(w, h) * 0.27;
  return major.map((cl, i) => {
    const angle = (i / major.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...cl,
      x: cx + cr * Math.cos(angle) + MAP_PAD,
      y: cy + cr * Math.sin(angle) + MAP_PAD,
    };
  });
}

function clampVBX(v: number, vbW = SW) {
  return Math.max(0, Math.min(CANVAS_W - vbW, v));
}
function clampVBY(v: number, vbH = SH) {
  return Math.max(0, Math.min(CANVAS_H - vbH, v));
}

// ── Capture step components ─────────────────────────────────────

type CaptureMode = 'link' | 'text' | 'quote';

function normalizeLinkInput(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#]|$)/i.test(v)) return `https://${v}`;
  return v;
}

function edgeLabel(type: MemoryEdgeType): string {
  switch (type) {
    case 'REINFORCES': return 'reinforces';
    case 'CONTRADICTS': return 'challenges';
    case 'RECURS': return 'recurs in';
    case 'EVOLVES_FROM': return 'evolves from';
    default: return 'connects to';
  }
}

function Divider({ c }: { c: AppThemeColors }) {
  return <View style={[sh.divider, { backgroundColor: c.border }]} />;
}

function StepOne({
  mode, setMode, payload, setPayload, error, onNext, onClose, onPaste, c,
}: {
  mode: CaptureMode; setMode: (m: CaptureMode) => void;
  payload: string; setPayload: (s: string) => void;
  error: string; onNext: () => void; onClose: () => void; onPaste: () => void;
  c: AppThemeColors;
}) {
  return (
    <View>
      <Text variant="serifLg" color="primary" style={sh.heading}>What are you saving?</Text>
      <Text variant="monoSmall" color="muted" style={sh.sub}>A link, thought, or passage.</Text>
      <Divider c={c} />
      <View style={sh.modeRow}>
        {(['link', 'text', 'quote'] as CaptureMode[]).map((m) => {
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
      <View style={[sh.inputBox, { borderColor: c.border }]}>
        <Text variant="monoSmall" style={[sh.inputLabel, { color: c.muted }]}>
          {mode === 'link' ? 'URL_' : mode === 'quote' ? 'PASSAGE_' : 'THOUGHT_'}
        </Text>
        <TextInput
          style={[sh.inputField, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
          value={payload}
          onChangeText={setPayload}
          placeholder={mode === 'link' ? 'https://...' : mode === 'quote' ? 'a passage worth preserving...' : 'fragments are fine.'}
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

function StepTwo({
  reaction, setReaction, error, busy, onBack, onCommit, c,
}: {
  reaction: string; setReaction: (s: string) => void;
  error: string; busy: boolean; onBack: () => void; onCommit: () => void;
  c: AppThemeColors;
}) {
  return (
    <View>
      <Text variant="serifLg" color="primary" style={sh.heading}>Your reaction.</Text>
      <Text variant="monoSmall" color="muted" style={sh.sub}>Optional. One line. Stays private.</Text>
      <Divider c={c} />
      <View style={[sh.inputBox, { borderColor: c.border }]}>
        <Text variant="monoSmall" style={[sh.inputLabel, { color: c.muted }]}>REACTION_</Text>
        <TextInput
          style={[sh.inputField, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
          value={reaction}
          onChangeText={setReaction}
          placeholder="a single reflex. or nothing."
          placeholderTextColor={c.faint}
          multiline
          autoFocus
        />
      </View>
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
            {busy ? 'synthesizing...' : 'commit →'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function StepThree({
  result, onViewInsight, onBackToMap, c,
}: {
  result: CaptureResponse; onViewInsight: () => void; onBackToMap: () => void;
  c: AppThemeColors;
}) {
  const topConnections = result.related?.slice(0, 3) ?? [];
  const { threadContext, recommendations } = result;

  return (
    <View>
      <Text variant="monoSmall" style={{ color: c.muted, textAlign: 'center', letterSpacing: 2.5, marginTop: Spacing[2] }}>
        ── committed to memory ──
      </Text>
      <Text variant="serifLg" color="primary" style={[sh.heading, { marginTop: Spacing[5] }]} numberOfLines={4}>
        {result.title ?? result.rawText?.slice(0, 120) ?? 'Saved.'}
      </Text>

      {!!threadContext && threadContext.captureCount >= 2 && (
        <View style={{ marginTop: Spacing[3], marginBottom: Spacing[2] }}>
          <Text variant="monoSmall" style={{ color: c.muted }}>
            capture {threadContext.captureCount} on {threadContext.topicName.toLowerCase()}.
          </Text>
        </View>
      )}

      <Divider c={c} />

      {topConnections.length > 0 && (
        <View style={{ marginBottom: Spacing[5] }}>
          <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[3] }}>CONNECTED TO_</Text>
          {topConnections.map((item) => (
            <View key={item.id} style={{ marginBottom: Spacing[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[2] }}>
                <Text variant="monoSmall" style={{ color: c.faint, marginTop: 2 }}>
                  {edgeLabel(item.edgeType ?? 'RELATED')} ·
                </Text>
                <Text variant="serif" color="secondary" style={{ flex: 1 }} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {!!recommendations && recommendations.length > 0 && (
        <View style={{ marginBottom: Spacing[5] }}>
          <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[3] }}>WHERE TO GO NEXT_</Text>
          {recommendations.map((rec: Recommendation, i: number) => (
            <View key={i} style={{ marginBottom: Spacing[4] }}>
              <Text variant="serif" color="primary" numberOfLines={2}>{rec.title}</Text>
              <Text variant="monoSmall" style={{ color: c.faint, marginTop: Spacing[1] }}>{rec.author}</Text>
              <Text variant="monoSmall" style={{ color: c.muted, marginTop: Spacing[2], lineHeight: 16 }} numberOfLines={3}>
                {rec.why}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Divider c={c} />
      <View style={sh.actions}>
        <Pressable onPress={onBackToMap} style={sh.secondaryBtn}>
          <Text variant="monoSmall" style={{ color: c.muted }}>← map</Text>
        </Pressable>
        <Pressable onPress={onViewInsight} style={[sh.primaryBtn, { backgroundColor: c.text }]}>
          <Text variant="monoSmall" style={{ color: c.background }}>view insight →</Text>
        </Pressable>
      </View>
    </View>
  );
}


const sh = StyleSheet.create({
  divider: { height: 1, marginVertical: Spacing[5] },
  heading: { marginTop: Spacing[6], marginBottom: Spacing[2] },
  sub: { opacity: 0.7 },
  modeRow: { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[4] },
  modeChip: { paddingVertical: Spacing[2], paddingHorizontal: Spacing[3], borderRadius: Radius.xs, borderWidth: 1 },
  inputBox: { borderWidth: 1, borderRadius: Radius.xs, padding: Spacing[4], marginTop: Spacing[2] },
  inputLabel: { marginBottom: Spacing[2] },
  inputField: { minHeight: 72, paddingVertical: Spacing[1] },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secondaryBtn: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[2] },
  primaryBtn: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[5], borderRadius: Radius.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  chip: { borderWidth: 1, borderRadius: Radius.xs, paddingVertical: 3, paddingHorizontal: Spacing[3] },
});

// ── Toolbar ─────────────────────────────────────────────────────

type ToolMode = 'move' | 'select' | 'search';

function Toolbar({
  toolMode, setToolMode, c,
}: {
  toolMode: ToolMode;
  setToolMode: (m: ToolMode) => void;
  c: AppThemeColors;
}) {
  const iconColor = (active: boolean) => (active ? c.text : c.muted);
  const tools: { id: ToolMode; label: string; Icon: typeof Hand }[] = [
    { id: 'move', label: 'Pan map', Icon: Hand },
    { id: 'select', label: 'Select point', Icon: MousePointer2 },
    { id: 'search', label: 'Find on map', Icon: Search },
  ];

  return (
    <View style={[tb.pill, { backgroundColor: c.elevated, borderColor: c.border }]}>
      {tools.map((tool, i) => {
        const active = toolMode === tool.id;
        return (
          <React.Fragment key={tool.id}>
            {i > 0 && <View style={[tb.sep, { backgroundColor: c.border }]} />}
            <Pressable
              onPress={() => setToolMode(tool.id)}
              style={[tb.btn, active && { backgroundColor: c.surface }]}
              accessibilityLabel={tool.label}
              accessibilityRole="button"
            >
              <tool.Icon size={18} color={iconColor(active)} strokeWidth={1.5} />
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
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: { width: 1, height: 20 },
});

function CenterFocusButton({
  onPress,
  color,
  borderColor,
}: {
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
      <Svg width={18} height={18} viewBox="0 0 18 18">
        <Rect x={1.5} y={1.5} width={15} height={15} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 2.5" />
        <Circle cx={9} cy={9} r={1.5} fill={color} />
        <Line x1={9} y1={4} x2={9} y2={14} stroke={color} strokeWidth={0.7} strokeDasharray="1.5 1.5" />
        <Line x1={4} y1={9} x2={14} y2={9} stroke={color} strokeWidth={0.7} strokeDasharray="1.5 1.5" />
      </Svg>
    </Pressable>
  );
}

// ── Main screen ─────────────────────────────────────────────────

export default function MapScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: graphData, loading: graphLoading, refetch: refetchGraph } = useApiQuery(
    () => api.memory.graph({ limit: 80 }),
    [],
  );

  useFocusEffect(useCallback(() => { void refetchGraph(); }, [refetchGraph]));

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const clusters = graphData?.clusters ?? [];
  const rawPos = useMemo(() => layoutGraph(nodes, clusters, edges, LAYOUT_W, LAYOUT_H), [nodes, clusters, edges]);
  const pos = useMemo(() => applyLayoutOffset(rawPos), [rawPos]);
  const clusterLabels = useMemo(() => clusterLabelPositions(clusters, LAYOUT_W, LAYOUT_H), [clusters]);

  const clusterColorMap = useMemo(() => {
    const map = new Map<string, string>();
    clusterLabels.forEach((cl, i) => {
      map.set(cl.topicId, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]);
    });
    return map;
  }, [clusterLabels]);

  // ── Tool state ──────────────────────────────────────────────
  const [toolMode, setToolMode] = useState<ToolMode>('select');
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

  // ── Viewport: pan + zoom ────────────────────────────────────
  const savedVB = useRef({ x: INIT_VB_X, y: INIT_VB_Y });
  const [vbPos, setVbPos] = useState({ x: INIT_VB_X, y: INIT_VB_Y });

  const savedZoom = useRef(0.4);
  const [zoom, setZoom] = useState(0.4);

  // Track pinch start state inside PanResponder (accessed via ref)
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  const resetView = useCallback(() => {
    const nx = INIT_VB_X;
    const ny = INIT_VB_Y;
    savedVB.current = { x: nx, y: ny };
    savedZoom.current = 0.4;
    setVbPos({ x: nx, y: ny });
    setZoom(0.4);
  }, []);

  // ── Smooth camera transition ────────────────────────────────
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

  const centerOnNodes = useCallback(() => {
    if (nodes.length === 0) {
      resetView();
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let count = 0;
    for (const node of nodes) {
      const p = pos[node.id];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      count++;
    }
    if (count === 0) { resetView(); return; }

    const PAD = 72;
    const boundsW = maxX - minX + PAD * 2;
    const boundsH = maxY - minY + PAD * 2;

    const fitZoom = Math.min(SW / boundsW, (SH - TAB_H) / boundsH, 2.5);
    const newZoom = Math.max(ZOOM_MIN, fitZoom);
    const vbW = SW / newZoom;
    const vbH = SH / newZoom;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const nx = clampVBX(centerX - vbW / 2, vbW);
    const ny = clampVBY(centerY - vbH / 2, vbH);

    savedVB.current = { x: nx, y: ny };
    savedZoom.current = newZoom;
    setVbPos({ x: nx, y: ny });
    setZoom(newZoom);
  }, [nodes, pos, resetView]);

  const mapPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) =>
        evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.touches.length >= 2 ||
        Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          pinchStartRef.current = {
            dist: Math.sqrt(dx * dx + dy * dy),
            zoom: savedZoom.current,
          };
        }
      },

      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2 && pinchStartRef.current) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const raw = pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist);
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, raw));
          const vbW = SW / newZoom;
          const vbH = SH / newZoom;
          const cx = clampVBX(savedVB.current.x, vbW);
          const cy = clampVBY(savedVB.current.y, vbH);
          savedZoom.current = newZoom;
          savedVB.current = { x: cx, y: cy };
          setZoom(newZoom);
          setVbPos({ x: cx, y: cy });
          return;
        }
        const vbW = SW / savedZoom.current;
        const vbH = SH / savedZoom.current;
        setVbPos({
          x: clampVBX(savedVB.current.x - gs.dx / savedZoom.current, vbW),
          y: clampVBY(savedVB.current.y - gs.dy / savedZoom.current, vbH),
        });
      },

      onPanResponderRelease: (evt, gs) => {
        if (pinchStartRef.current) {
          pinchStartRef.current = null;
          return;
        }
        const vbW = SW / savedZoom.current;
        const vbH = SH / savedZoom.current;
        const nx = clampVBX(savedVB.current.x - gs.dx / savedZoom.current, vbW);
        const ny = clampVBY(savedVB.current.y - gs.dy / savedZoom.current, vbH);
        savedVB.current = { x: nx, y: ny };
        setVbPos({ x: nx, y: ny });
      },
    }),
  ).current;

  // ── Drawer state ────────────────────────────────────────────
  const DRAWER_W = SW * 0.76;
  type ClusterLabel = ReturnType<typeof clusterLabelPositions>[0];
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerCluster, setDrawerCluster] = useState<ClusterLabel | null>(null);
  // right:0 anchors the drawer to the right edge; translateX:0 = fully visible, translateX:DRAWER_W = off-screen
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


  // ── Node selection ──────────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // ── Capture state ───────────────────────────────────────────
  const [showCapture, setShowCapture] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<CaptureMode>('link');
  const [payload, setPayload] = useState('');
  const [reaction, setReaction] = useState('');
  const [captureResult, setCaptureResult] = useState<CaptureResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [newNodeId, setNewNodeId] = useState<string | null>(null);
  const landingAnim = useRef(new RNAnimated.Value(0)).current;
  const animatingRef = useRef(false);

  const slideY = useRef(new RNAnimated.Value(SH)).current;
  const fabPulse = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(fabPulse, { toValue: 1, duration: 2600, useNativeDriver: true }),
        RNAnimated.timing(fabPulse, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fabPulse]);

  const openCapture = useCallback(() => {
    closeDrawer();
    setSelectedNode(null);
    setStep(1);
    setPayload('');
    setReaction('');
    setCaptureResult(null);
    setCaptureError('');
    setMode('link');
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
    if (!payload.trim()) {
      setCaptureError('Enter a URL or thought first.');
      return;
    }
    setCaptureError('');
    setStep(2);
  }, [payload]);

  const commit = useCallback(async () => {
    setBusy(true);
    setCaptureError('');
    try {
      let kind: CaptureKind = 'TEXT';
      let url: string | undefined;
      let text: string | undefined;
      if (mode === 'link') {
        kind = 'LINK';
        url = normalizeLinkInput(payload);
      } else if (mode === 'quote') {
        kind = 'QUOTE';
        text = payload.trim();
      } else {
        kind = 'TEXT';
        text = payload.trim();
      }
      const res = await api.captures.create({ kind, url, text, reaction: reaction.trim() || undefined });
      setCaptureResult(res);
      setStep(3);
      setNewNodeId(res.id);
      void refetchGraph();
    } catch (e) {
      setCaptureError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      setBusy(false);
    }
  }, [mode, payload, reaction, refetchGraph]);

  const pasteFromClipboard = useCallback(async () => {
    const t = (await Clipboard.getStringAsync()).trim();
    if (!t) return;
    setPayload(t);
    if (/^https?:\/\//i.test(t)) setMode('link');
  }, []);

  const ringOpacity = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.4] });
  const ringScale = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.75] });
  const isEmpty = !graphLoading && nodes.length === 0;

  useEffect(() => {
    if (toolMode === 'search') {
      setTimeout(() => searchInputRef.current?.focus(), 120);
    }
  }, [toolMode]);

  useEffect(() => {
    if (!newNodeId || !pos[newNodeId] || animatingRef.current) return;
    animatingRef.current = true;
    landingAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(landingAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      RNAnimated.timing(landingAnim, { toValue: 0, duration: 750, useNativeDriver: true }),
    ]).start(() => {
      animatingRef.current = false;
      setNewNodeId(null);
    });
  }, [newNodeId, pos, landingAnim]);

  const nodeColor = useCallback(
    (node: GraphNode): string => {
      for (const t of node.topics) {
        const color = clusterColorMap.get(t.topicId);
        if (color) return color;
      }
      return darkColors.mapNode;
    },
    [clusterColorMap],
  );

  const vbW = SW / zoom;
  const vbH = SH / zoom;

  const landingRing = newNodeId && pos[newNodeId] ? (() => {
    const p = pos[newNodeId]!;
    const screenX = (p.x - vbPos.x) * zoom;
    const screenY = (p.y - vbPos.y) * zoom;
    const ringSize = 44;
    const newNodeRingScale = landingAnim.interpolate({
      inputRange: [0, 0.4, 1],
      outputRange: [0.5, 2.4, 3.8],
    });
    const newNodeRingOpacity = landingAnim.interpolate({
      inputRange: [0, 0.25, 1],
      outputRange: [0, 0.55, 0],
    });
    return (
      <RNAnimated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: 1.5,
          borderColor: c.text,
          left: screenX - ringSize / 2,
          top: screenY - ringSize / 2,
          transform: [{ scale: newNodeRingScale }],
          opacity: newNodeRingOpacity,
        }}
      />
    );
  })() : null;

  return (
    <View style={[styles.root, { backgroundColor: darkColors.mapBackground }]}>

      {/* ── Static full-screen background — fills gaps exposed by 2.5D tilt ── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SW} height={SH} style={StyleSheet.absoluteFill}>
          <Defs>
            <Pattern id="staticDotGrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <Circle cx="16" cy="16" r="0.9" fill={darkColors.mapNode} fillOpacity={0.04} />
            </Pattern>
          </Defs>
          <Rect x="0" y="0" width={SW} height={SH} fill="url(#staticDotGrid)" />
        </Svg>
      </View>

      {/* ── Pannable map canvas ── */}
      <View style={StyleSheet.absoluteFill}>
        <View style={StyleSheet.absoluteFill} {...mapPan.panHandlers}>

          <Svg
            width={SW}
            height={SH}
            viewBox={`${vbPos.x} ${vbPos.y} ${vbW} ${vbH}`}
            style={StyleSheet.absoluteFill}
          >
            <Defs>
              {/* Subtle dot grid repeating pattern */}
              <Pattern id="dotGrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
                <Circle cx="16" cy="16" r="0.9" fill={darkColors.mapNode} fillOpacity={0.04} />
              </Pattern>

              {/* Warm ambient vignette */}
              <RadialGradient id="ambientGlow" cx="50%" cy="44%" r="48%" fx="50%" fy="44%">
                <Stop offset="0%" stopColor={darkColors.mapNode} stopOpacity={0.06} />
                <Stop offset="100%" stopColor={darkColors.mapNode} stopOpacity={0} />
              </RadialGradient>

              {/* Per-cluster fills */}
              {clusterLabels.map((cl, i) => {
                const color = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
                return (
                  <RadialGradient
                    key={`grad-${cl.topicId}`}
                    id={`clGrad-${cl.topicId}`}
                    cx="50%" cy="50%" r="50%"
                    fx="50%" fy="50%"
                  >
                    <Stop offset="0%" stopColor={color} stopOpacity={0.14} />
                    <Stop offset="55%" stopColor={color} stopOpacity={0.04} />
                    <Stop offset="100%" stopColor={color} stopOpacity={0} />
                  </RadialGradient>
                );
              })}

              {/* 2.5D sphere shine overlay — reused for all nodes */}
              <RadialGradient id="sphereShine" cx="36%" cy="30%" r="68%" fx="36%" fy="30%">
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.78} />
                <Stop offset="42%" stopColor="#FFFFFF" stopOpacity={0.04} />
                <Stop offset="100%" stopColor="#000000" stopOpacity={0.22} />
              </RadialGradient>

              {/* Subtle background gradient — warm top, slightly cooler bottom */}
              <LinearGradient id="bgTone" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={darkColors.mapNode} stopOpacity={0.012} />
                <Stop offset="100%" stopColor={darkColors.mapNode} stopOpacity={0.03} />
              </LinearGradient>
            </Defs>

            <G>
              {/* Dot grid background */}
              <Rect width={CANVAS_W} height={CANVAS_H} fill="url(#dotGrid)" />

              {/* Warm tone wash */}
              <Rect width={CANVAS_W} height={CANVAS_H} fill="url(#bgTone)" />

              {/* Ambient glow */}
              <Rect width={CANVAS_W} height={CANVAS_H} fill="url(#ambientGlow)" />

              {/* Cluster region halos */}
              {clusterLabels.map((cl) => {
                const clusterR = Math.min(LAYOUT_W, LAYOUT_H) * 0.16;
                return (
                  <Circle
                    key={`cl-area-${cl.topicId}`}
                    cx={cl.x} cy={cl.y} r={clusterR}
                    fill={`url(#clGrad-${cl.topicId})`}
                  />
                );
              })}

              {/* Cluster labels — large at low zoom, fade at high zoom */}
              {clusterLabels.map((cl) => {
                const clFontSize = Math.max(9, Math.min(22, 14 / zoom));
                const clOpacity = zoom > 1.4
                  ? Math.max(0, (1 - (zoom - 1.4) / 0.6) * 0.14)
                  : 0.12 + (1 - zoom) * 0.10; // slightly more visible at low zoom
                return (
                  <SvgText
                    key={`cl-label-${cl.topicId}`}
                    x={cl.x} y={cl.y}
                    fontSize={clFontSize}
                    fontFamily={FontFamily.mono}
                    fill={c.text}
                    fillOpacity={Math.min(0.28, clOpacity)}
                    textAnchor="middle"
                    letterSpacing={3.5}
                  >
                    {cl.name.toUpperCase()}
                  </SvgText>
                );
              })}

              {/* Edges */}
              {edges.map((e, i) => {
                const a = pos[e.fromItemId];
                const b = pos[e.toItemId];
                if (!a || !b) return null;
                const opacity = 0.07 + e.weight * 0.24;
                return (
                  <Line
                    key={`e${i}`}
                    x1={a.x} y1={a.y}
                    x2={b.x} y2={b.y}
                    stroke={darkColors.mapLine}
                    strokeWidth={0.7}
                    strokeOpacity={opacity}
                  />
                );
              })}

              {/* Nodes — fade in as zoom increases past 0.5 */}
              {nodes.map((node) => {
                const p = pos[node.id];
                if (!p) return null;
                const rng = seededRng(hashId(node.id));
                const baseR = 2.4 + rng() * 2.8;
                const baseOpacity = 0.65 + rng() * 0.35;
                const color = nodeColor(node);

                const isHighlighted = hasSearch && highlightedIds.has(node.id);
                const isDimmed = hasSearch && !highlightedIds.has(node.id);

                // Nodes emerge as user zooms in
                const zoomFade = zoom < 0.5 ? 0 : zoom < 0.9 ? (zoom - 0.5) / 0.4 : 1;
                const finalOpacity = isDimmed
                  ? baseOpacity * 0.12 * zoomFade
                  : baseOpacity * zoomFade;

                const glowR = isHighlighted ? baseR * 9 : baseR * 5.5;
                return (
                  <G key={node.id}>
                    <Circle cx={p.x} cy={p.y} r={glowR} fill={color} fillOpacity={isDimmed ? 0 : (isHighlighted ? 0.1 : 0.03) * zoomFade} />
                    <Circle cx={p.x} cy={p.y} r={baseR * 2.8} fill={color} fillOpacity={isDimmed ? 0 : (isHighlighted ? 0.22 : 0.09) * zoomFade} />
                    <Circle
                      cx={p.x} cy={p.y} r={isHighlighted ? baseR * 1.7 : baseR}
                      fill={isHighlighted ? color : darkColors.mapNode}
                      fillOpacity={finalOpacity}
                    />
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
                  cx={MAP_PAD + LAYOUT_W * rx}
                  cy={MAP_PAD + LAYOUT_H * ry}
                  r={2.5}
                  fill={darkColors.mapNode}
                  fillOpacity={0.07}
                />
              ))}
            </G>
          </Svg>

          {/* ── Node touch targets ── */}
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents={toolMode === 'move' ? 'none' : 'box-none'}
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
                  style={{
                    position: 'absolute',
                    width: HIT * 2,
                    height: HIT * 2,
                    left: screenX - HIT,
                    top: screenY - HIT,
                    borderRadius: HIT,
                  }}
                  onPress={() => {
                    if (selectedNode?.id === node.id) {
                      closeDrawer();
                    } else {
                      setSelectedNode(node);
                      setDrawerCluster(null);
                      openDrawer(null);
                    }
                  }}
                  accessibilityLabel={node.label}
                  accessibilityRole="button"
                />
              );
            })}
            {/* Cluster label touch targets */}
            {clusterLabels.map((cl) => {
              const screenX = (cl.x - vbPos.x) * zoom;
              const screenY = (cl.y - vbPos.y) * zoom;
              if (screenX < -60 || screenX > SW + 60 || screenY < -30 || screenY > SH + 30) return null;
              return (
                <Pressable
                  key={`cl-tap-${cl.topicId}`}
                  style={{
                    position: 'absolute',
                    left: screenX - 52,
                    top: screenY - 18,
                    width: 104,
                    height: 36,
                  }}
                  onPress={() => handleClusterTap(cl)}
                  accessibilityLabel={`${cl.name} cluster`}
                  accessibilityRole="button"
                />
              );
            })}
          </View>

        </View>

        {/* ── New node landing animation ── */}
        {landingRing}

      </View>

      {/* ── Fixed overlay ── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        {/* ── Header ── */}
        <View
          style={[styles.header, { paddingTop: insets.top + 6 }]}
          pointerEvents="box-none"
        >
          <Text variant="wordmark" color="primary">atlas</Text>
          <View style={styles.headerRight} pointerEvents="box-none">
            {graphLoading && (
              <Text variant="monoSmall" style={{ color: c.muted, letterSpacing: 2, marginRight: Spacing[3] }}>·</Text>
            )}
            <Toolbar toolMode={toolMode} setToolMode={setToolMode} c={c} />
          </View>
        </View>

        {/* ── Search bar ── */}
        {toolMode === 'search' && (
          <View
            style={[styles.searchBar, { top: insets.top + 56, backgroundColor: c.elevated, borderColor: c.border }]}
            pointerEvents="auto"
          >
            <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.faint, marginRight: Spacing[2], letterSpacing: 1.5 }}>
              FIND_
            </Text>
            <TextInput
              ref={searchInputRef}
              style={{ flex: 1, fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: c.text, paddingVertical: 0 }}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="topic or keyword..."
              placeholderTextColor={c.faint}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {hasSearch && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.muted }}>✕</Text>
              </Pressable>
            )}
            {hasSearch && (
              <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.muted, marginLeft: Spacing[3] }}>
                {highlightedIds.size}
              </Text>
            )}
          </View>
        )}

        {/* ── Empty state ── */}
        {isEmpty && (
          <View style={styles.emptyHint} pointerEvents="none">
            <Text variant="monoSmall" style={{ color: c.faint, textAlign: 'center', letterSpacing: 4, marginBottom: Spacing[5] }}>
              · · ·
            </Text>
            <Text variant="serif" color="muted" style={{ textAlign: 'center', marginBottom: Spacing[3] }}>
              the atlas is empty
            </Text>
            <Text variant="monoSmall" style={{ color: c.faint, textAlign: 'center', lineHeight: 20 }}>
              {'Save your first capture using\nthe + button below.'}
            </Text>
          </View>
        )}

        {/* ── Center + count (bottom-left) ── */}
        {nodes.length > 0 && !showCapture && !drawerVisible && (
          <View style={[styles.mapMeta, { bottom: TAB_H + Spacing[5] }]} pointerEvents="box-none">
            <CenterFocusButton onPress={centerOnNodes} color={c.muted} borderColor={c.borderSubtle} />
            <Text variant="monoSmall" style={{ color: c.faint, marginLeft: Spacing[3] }}>
              {nodes.length} {nodes.length === 1 ? 'point' : 'points'}
            </Text>
          </View>
        )}

        {/* ── Right-side drawer for node / cluster details ── */}
        {drawerVisible && !showCapture && (
          <>
            {/* Dim overlay on the left (pressable to dismiss) */}
            <Pressable
              style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.3)' }]}
              onPress={closeDrawer}
              accessibilityLabel="Close detail panel"
            />
            <RNAnimated.View
              style={[
                styles.drawer,
                {
                  width: DRAWER_W,
                  backgroundColor: c.background,
                  borderLeftColor: c.border,
                  transform: [{ translateX: drawerX }],
                },
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
                    <Text variant="h2" style={{ marginBottom: Spacing[2] }}>{drawerCluster.name}</Text>
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
                      onPress={() => {
                        closeDrawer();
                        router.push(`/insight/${selectedNode.id}` as never);
                      }}
                      style={{ marginTop: Spacing[2] }}
                    >
                      <Text variant="monoSmall" color="muted">view insight →</Text>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </RNAnimated.View>
          </>
        )}

        {/* ── FAB — only visible when no drawer is open ── */}
        {!showCapture && !drawerVisible && (
          <View style={[styles.fabWrap, { bottom: TAB_H + Spacing[5] }]} pointerEvents="box-none">
            <RNAnimated.View
              style={[styles.fabRing, { borderColor: c.text, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
              pointerEvents="none"
            />
            <Pressable
              onPress={openCapture}
              style={[styles.fab, { backgroundColor: c.text }]}
              accessibilityLabel="Capture new memory"
              accessibilityRole="button"
            >
              <Text style={[styles.fabPlus, { color: c.background }]}>+</Text>
            </Pressable>
          </View>
        )}

        {/* ── Backdrop — prevents map bleed through rounded modal corners ── */}
        {showCapture && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} pointerEvents="none" />
        )}

        {/* ── Capture modal ── */}
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
                  {([1, 2, 3] as const).map((s) => (
                    <React.Fragment key={s}>
                      <View
                        style={[styles.stepDot, { backgroundColor: step >= s ? c.text : 'transparent', borderColor: step >= s ? c.text : c.border }]}
                      />
                      {s < 3 && <View style={[styles.stepLine, { backgroundColor: step > s ? c.text : c.border }]} />}
                    </React.Fragment>
                  ))}
                </View>
                <Text variant="monoSmall" style={[styles.stepLabel, { color: c.muted }]}>
                  {step === 1 ? '01 / CAPTURE' : step === 2 ? '02 / REACT' : '03 / COMMITTED'}
                </Text>
                <View style={styles.modalBody}>
                  {step === 1 && (
                    <StepOne
                      mode={mode} setMode={setMode}
                      payload={payload} setPayload={setPayload}
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
                    />
                  )}
                  {step === 3 && captureResult && (
                    <StepThree
                      result={captureResult}
                      onViewInsight={() => {
                        closeCapture();
                        router.push(`/insight/${captureResult.id}` as never);
                      }}
                      onBackToMap={closeCapture}
                      c={c}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[3],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
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
  emptyHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapMeta: {
    position: 'absolute',
    left: Spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerBtn: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    borderLeftWidth: 1,
  },
  drawerScroll: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[8],
  },
  drawerClose: {
    alignSelf: 'flex-end',
    marginBottom: Spacing[6],
    padding: Spacing[2],
  },
  drawerHairline: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing[4],
  },
  fabWrap: {
    position: 'absolute',
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fabRing: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    borderWidth: 1,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
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
