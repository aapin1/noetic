import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { AppThemeColors } from '@/constants/theme';
import type { CaptureKind, CaptureResponse, MemoryGraphResponse } from '@/types/api';

type GraphNode = MemoryGraphResponse['nodes'][number];

const { width: SW, height: SH } = Dimensions.get('window');
const TAB_H = Platform.OS === 'ios' ? 86 : 68;
const FAB_SIZE = 54;

// ── Deterministic layout helpers ─────────────────────────────

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

// Only clusters with ≥2 items are used as layout anchors — prevents
// singleton topics from distorting the wheel geometry.
const MAJOR_CLUSTER_MIN = 2;

function layoutGraph(
  nodes: MemoryGraphResponse['nodes'],
  clusters: MemoryGraphResponse['clusters'],
  w: number,
  h: number,
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return pos;

  const cx = w / 2;
  const cy = h * 0.44;
  const pad = 20;

  const majorClusters = clusters.filter((cl) => cl.count >= MAJOR_CLUSTER_MIN);

  if (majorClusters.length === 0) {
    nodes.forEach((node, i) => {
      const rng = seededRng(hashId(node.id));
      const r = Math.min(w, h) * (0.14 + rng() * 0.3);
      const angle = (i / nodes.length) * Math.PI * 2;
      pos[node.id] = {
        x: Math.max(pad, Math.min(w - pad, cx + r * Math.cos(angle))),
        y: Math.max(pad, Math.min(h - pad, cy + r * Math.sin(angle))),
      };
    });
    return pos;
  }

  // Place major cluster centres on a wheel
  const centres: Record<string, { x: number; y: number }> = {};
  const cr = Math.min(w, h) * 0.29;
  majorClusters.forEach((cl, i) => {
    const angle = (i / majorClusters.length) * Math.PI * 2 - Math.PI / 2;
    centres[cl.topicId] = { x: cx + cr * Math.cos(angle), y: cy + cr * Math.sin(angle) };
  });

  // Build a lookup: topicId → cluster centre (using first major topic found)
  const topicToCentre = new Map<string, { x: number; y: number }>(
    Object.entries(centres),
  );

  nodes.forEach((node) => {
    // Find the first topic on this node that has a major cluster centre
    const anchorTopic = node.topics.find((t) => topicToCentre.has(t.topicId));
    const centre = anchorTopic
      ? topicToCentre.get(anchorTopic.topicId)!
      : { x: cx, y: cy };
    const rng = seededRng(hashId(node.id));
    const jr = 16 + rng() * 42;
    const ja = rng() * Math.PI * 2;
    pos[node.id] = {
      x: Math.max(pad, Math.min(w - pad, centre.x + jr * Math.cos(ja))),
      y: Math.max(pad, Math.min(h - pad, centre.y + jr * Math.sin(ja))),
    };
  });
  return pos;
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
  const cr = Math.min(w, h) * 0.29;
  return major.map((cl, i) => {
    const angle = (i / major.length) * Math.PI * 2 - Math.PI / 2;
    return { ...cl, x: cx + cr * Math.cos(angle), y: cy + cr * Math.sin(angle) };
  });
}

// ── Step components ───────────────────────────────────────────

type CaptureMode = 'link' | 'text' | 'quote';

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
              style={[
                sh.modeChip,
                {
                  borderColor: active ? c.text : c.borderSubtle,
                  backgroundColor: active ? c.elevated : 'transparent',
                },
              ]}
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
          placeholder={
            mode === 'link'
              ? 'https://...'
              : mode === 'quote'
              ? 'a passage worth preserving...'
              : 'fragments are fine.'
          }
          placeholderTextColor={c.faint}
          multiline={mode !== 'link'}
          autoCapitalize={mode === 'link' ? 'none' : 'sentences'}
          keyboardType={mode === 'link' ? 'url' : 'default'}
          autoFocus
        />
        <Pressable onPress={onPaste} accessibilityLabel="Paste from clipboard">
          <Text variant="monoSmall" style={{ color: c.muted, marginTop: Spacing[3] }}>
            paste from clipboard ↑
          </Text>
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
      <Text variant="monoSmall" color="muted" style={sh.sub}>
        Optional. One line. Stays private.
      </Text>

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
  const topics = result.topics ?? [];
  const topInsight = result.insights?.[0] ?? null;

  return (
    <View>
      <Text
        variant="monoSmall"
        style={{ color: c.muted, textAlign: 'center', letterSpacing: 2.5, marginTop: Spacing[2] }}
      >
        ── committed to memory ──
      </Text>

      <Text variant="serifLg" color="primary" style={[sh.heading, { marginTop: Spacing[5] }]} numberOfLines={4}>
        {result.title ?? result.rawText?.slice(0, 120) ?? 'Saved.'}
      </Text>

      <Divider c={c} />

      {!!result.keyIdea && (
        <View style={{ marginBottom: Spacing[4] }}>
          <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[2] }}>KEY IDEA_</Text>
          <Text variant="serif" color="secondary">{result.keyIdea}</Text>
        </View>
      )}

      {topics.length > 0 && (
        <View style={{ marginBottom: Spacing[4] }}>
          <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[3] }}>
            ANALYZED TOPICS_
          </Text>
          <View style={sh.chipRow}>
            {topics.map((t) => (
              <View key={t.topicId} style={[sh.chip, { borderColor: c.borderSubtle }]}>
                <Text variant="monoSmall" style={{ color: c.muted }}>· {t.name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!!topInsight && (
        <View style={{ marginBottom: Spacing[4] }}>
          <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[2] }}>INSIGHT_</Text>
          <Text variant="serif" color="secondary">{topInsight.headline}</Text>
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

// ── Node info card ────────────────────────────────────────────

function NodeCard({
  node, onClose, onViewInsight, c,
}: {
  node: GraphNode;
  onClose: () => void;
  onViewInsight: (id: string) => void;
  c: AppThemeColors;
}) {
  const date = new Date(node.capturedAt);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <View style={[nc.card, { backgroundColor: c.elevated, borderColor: c.border }]}>
      <View style={nc.cardHeader}>
        <View style={nc.cardMeta}>
          <Text variant="monoSmall" style={{ color: c.faint }}>{node.kind.toLowerCase()}</Text>
          <Text variant="monoSmall" style={{ color: c.faint }}>{dateStr}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
          <Text variant="monoSmall" style={{ color: c.muted }}>✕</Text>
        </Pressable>
      </View>

      <Text variant="serifLg" color="primary" numberOfLines={3} style={nc.title}>
        {node.label}
      </Text>

      {!!node.keyIdea && (
        <Text variant="monoSmall" style={[nc.keyIdea, { color: c.muted }]} numberOfLines={3}>
          {node.keyIdea}
        </Text>
      )}

      {!!node.reaction && (
        <Text variant="monoSmall" style={[nc.reaction, { color: c.muted }]} numberOfLines={2}>
          "{node.reaction}"
        </Text>
      )}

      {node.topics.length > 0 && (
        <View style={nc.topics}>
          {node.topics.slice(0, 6).map((t) => (
            <View key={t.topicId} style={[nc.chip, { borderColor: c.borderSubtle }]}>
              <Text variant="monoSmall" style={{ color: c.faint }}>· {t.name}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={() => onViewInsight(node.id)} style={nc.insightLink}>
        <Text variant="monoSmall" style={{ color: c.muted }}>view insight →</Text>
      </Pressable>
    </View>
  );
}

const nc = StyleSheet.create({
  card: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[6],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[3],
  },
  cardMeta: { flexDirection: 'row', gap: Spacing[4] },
  title: { marginBottom: Spacing[3] },
  keyIdea: { marginBottom: Spacing[3], lineHeight: 16 },
  reaction: { marginBottom: Spacing[3], fontStyle: 'italic' },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing[4] },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: 2,
    paddingHorizontal: Spacing[2],
  },
  insightLink: {},
});

// Shared step styles
const sh = StyleSheet.create({
  divider: { height: 1, marginVertical: Spacing[5] },
  heading: { marginTop: Spacing[6], marginBottom: Spacing[2] },
  sub: { opacity: 0.7 },
  modeRow: { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[4] },
  modeChip: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.xs,
    borderWidth: 1,
  },
  inputBox: { borderWidth: 1, borderRadius: Radius.xs, padding: Spacing[4], marginTop: Spacing[2] },
  inputLabel: { marginBottom: Spacing[2] },
  inputField: { minHeight: 72, paddingVertical: Spacing[1] },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secondaryBtn: { paddingVertical: Spacing[3], paddingHorizontal: Spacing[2] },
  primaryBtn: {
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[5],
    borderRadius: Radius.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: 3,
    paddingHorizontal: Spacing[3],
  },
});

// ── Main screen ───────────────────────────────────────────────

export default function MapScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: graphData, loading: graphLoading, refetch: refetchGraph } = useApiQuery(
    () => api.memory.graph({ limit: 80 }),
    [],
  );

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const clusters = graphData?.clusters ?? [];
  const pos = useMemo(() => layoutGraph(nodes, clusters, SW, SH), [nodes, clusters]);
  const clusterLabels = useMemo(() => clusterLabelPositions(clusters, SW, SH), [clusters]);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Capture modal state
  const [showCapture, setShowCapture] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<CaptureMode>('link');
  const [payload, setPayload] = useState('');
  const [reaction, setReaction] = useState('');
  const [captureResult, setCaptureResult] = useState<CaptureResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');

  const slideY = useRef(new Animated.Value(SH)).current;
  const fabPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fabPulse, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(fabPulse, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fabPulse]);

  const openCapture = useCallback(() => {
    setSelectedNode(null);
    setStep(1);
    setPayload('');
    setReaction('');
    setCaptureResult(null);
    setCaptureError('');
    setMode('link');
    setShowCapture(true);
    slideY.setValue(SH);
    Animated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 170 }).start();
  }, [slideY]);

  const closeCapture = useCallback(() => {
    Animated.timing(slideY, { toValue: SH, duration: 260, useNativeDriver: true }).start(() => {
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

  const ringOpacity = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.45] });
  const ringScale = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.8] });
  const isEmpty = !graphLoading && nodes.length === 0;
  // When a node card is shown the FAB floats above it (~220px card estimate)
  const fabBottom = selectedNode && !showCapture ? TAB_H + 240 : TAB_H + 20;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>

      {/* ── Cognitive map SVG ── */}
      <Svg width={SW} height={SH} style={StyleSheet.absoluteFill}>
        <G>
          {/* Ghost cluster watermarks */}
          {clusterLabels.map((cl) => (
            <SvgText
              key={cl.topicId}
              x={cl.x}
              y={cl.y}
              fontSize={13}
              fontFamily={FontFamily.mono}
              fill={c.text}
              fillOpacity={0.045}
              textAnchor="middle"
            >
              {cl.name.toUpperCase()}
            </SvgText>
          ))}

          {/* Edges */}
          {edges.map((e, i) => {
            const a = pos[e.fromItemId];
            const b = pos[e.toItemId];
            if (!a || !b) return null;
            return (
              <Line
                key={`e${i}`}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke={c.graphLine}
                strokeWidth={0.55}
                strokeOpacity={0.1 + e.weight * 0.26}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const p = pos[node.id];
            if (!p) return null;
            const rng = seededRng(hashId(node.id));
            const r = 2.0 + rng() * 2.2;
            const opacity = 0.65 + rng() * 0.35;
            return (
              <Circle
                key={node.id}
                cx={p.x} cy={p.y} r={r}
                fill={c.graphNode}
                fillOpacity={opacity}
              />
            );
          })}

          {/* Ghost dots for empty state */}
          {isEmpty && [
            [0.28, 0.28], [0.58, 0.22], [0.72, 0.45], [0.62, 0.60],
            [0.36, 0.58], [0.48, 0.38], [0.42, 0.50], [0.68, 0.33],
            [0.30, 0.42], [0.55, 0.52], [0.44, 0.30], [0.65, 0.55],
          ].map(([rx, ry], i) => (
            <Circle key={`g${i}`} cx={SW * rx} cy={SH * ry} r={2} fill={c.graphNode} fillOpacity={0.1} />
          ))}
        </G>
      </Svg>

      {/* ── Node touch targets (invisible, on top of SVG) ── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {nodes.map((node) => {
          const p = pos[node.id];
          if (!p) return null;
          const HIT = 22;
          return (
            <Pressable
              key={node.id}
              style={{
                position: 'absolute',
                width: HIT * 2,
                height: HIT * 2,
                left: p.x - HIT,
                top: p.y - HIT,
                borderRadius: HIT,
              }}
              onPress={() => setSelectedNode((prev) => prev?.id === node.id ? null : node)}
              accessibilityLabel={node.label}
              accessibilityRole="button"
            />
          );
        })}
      </View>

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Text variant="wordmark" color="primary">noetic</Text>
        {graphLoading && (
          <Text variant="monoSmall" style={{ color: c.muted, letterSpacing: 2 }}>·</Text>
        )}
      </View>

      {/* ── Empty state hint ── */}
      {isEmpty && (
        <View style={styles.emptyHint}>
          <Text variant="monoSmall" style={{ color: c.muted, textAlign: 'center', letterSpacing: 1.5 }}>
            {'your memory map\nbegins with one save.'}
          </Text>
        </View>
      )}

      {/* ── Node / edge count ── */}
      {nodes.length > 0 && (
        <View style={[styles.metaLabel, { bottom: TAB_H + 72 }]}>
          <Text variant="monoSmall" style={{ color: c.faint }}>
            {`${nodes.length}n  ${edges.length}e  ${clusters.length}c`}
          </Text>
        </View>
      )}

      {/* ── Node info card ── */}
      {selectedNode && !showCapture && (
        <View
          style={[
            styles.nodeCardWrap,
            { bottom: TAB_H, backgroundColor: c.elevated },
          ]}
        >
          <NodeCard
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onViewInsight={(id) => {
              setSelectedNode(null);
              router.push(`/insight/${id}` as never);
            }}
            c={c}
          />
        </View>
      )}

      {/* ── FAB ── */}
      <View style={[styles.fabWrap, { bottom: fabBottom }]}>
        <Animated.View
          style={[
            styles.fabRing,
            { borderColor: c.text, opacity: ringOpacity, transform: [{ scale: ringScale }] },
          ]}
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

      {/* ── Capture modal ── */}
      {showCapture && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.modal,
            { backgroundColor: c.background, transform: [{ translateY: slideY }] },
          ]}
        >
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              contentContainerStyle={[
                styles.modalScroll,
                { paddingBottom: insets.bottom + 48 },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Drag handle */}
              <View style={[styles.dragZone, { paddingTop: insets.top + 14 }]}>
                <View style={[styles.handle, { backgroundColor: c.border }]} />
              </View>

              {/* Step progress */}
              <View style={styles.stepRow}>
                {([1, 2, 3] as const).map((s) => (
                  <React.Fragment key={s}>
                    <View
                      style={[
                        styles.stepDot,
                        {
                          backgroundColor: step >= s ? c.text : 'transparent',
                          borderColor: step >= s ? c.text : c.border,
                        },
                      ]}
                    />
                    {s < 3 && (
                      <View
                        style={[
                          styles.stepLine,
                          { backgroundColor: step > s ? c.text : c.border },
                        ]}
                      />
                    )}
                  </React.Fragment>
                ))}
              </View>

              <Text variant="monoSmall" style={[styles.stepLabel, { color: c.muted }]}>
                {step === 1 ? '01 / CAPTURE' : step === 2 ? '02 / REACT' : '03 / COMMITTED'}
              </Text>

              <View style={styles.modalBody}>
                {step === 1 && (
                  <StepOne
                    mode={mode}
                    setMode={setMode}
                    payload={payload}
                    setPayload={setPayload}
                    error={captureError}
                    onNext={goNext}
                    onClose={closeCapture}
                    onPaste={() => void pasteFromClipboard()}
                    c={c}
                  />
                )}
                {step === 2 && (
                  <StepTwo
                    reaction={reaction}
                    setReaction={setReaction}
                    error={captureError}
                    busy={busy}
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
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  emptyHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaLabel: {
    position: 'absolute',
    left: Spacing[6],
  },
  nodeCardWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
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
  },
  fabPlus: {
    fontSize: 26,
    lineHeight: 30,
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
  handle: { width: 36, height: 4, borderRadius: 2, marginBottom: Spacing[4] },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[2] },
  stepDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 1 },
  stepLine: { flex: 1, height: 1, marginHorizontal: Spacing[2] },
  stepLabel: { letterSpacing: 2.2, marginBottom: Spacing[1] },
  modalBody: {},
});
