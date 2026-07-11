import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type {
  ContradictionCard,
  ConvergenceSignal,
  DormantThread,
  PersonalIntelligenceResponse,
  ThreadSynthesis,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────
// Mind is a single spatial canvas — a companion to Atlas. It reuses Atlas's
// camera model verbatim: an SVG viewBox driven by a pannable/pinchable camera
// and a requestAnimationFrame `animateCamera` easing tween for Maps-style
// flights. Four cognitive regions (Threads, Contradictions, Convergence,
// Dormant) live on a large world canvas. Only regions that actually have
// something to say are placed, and the layout re-centers around them.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.0;

const CANVAS_W = 2800;
const CANVAS_H = 2500;
const REGION_R = 430;

// The map is dark in both themes (Atlas convention); on-canvas text is light.
const ink = (o: number) => `rgba(236,236,236,${o})`;

type RegionKey = 'threads' | 'contradictions' | 'convergence' | 'dormant';

type RegionMeta = {
  key: RegionKey;
  name: string;
  color: string; // dulled, minimal accents — not vibrant
  sides: number; // geometric boundary sides (0 = organic circle)
  noun: (n: number) => string;
};

// Deliberately desaturated so the canvas reads calm and minimal.
const REGION_META: RegionMeta[] = [
  { key: 'threads', name: 'THREADS', color: '#6E90AE', sides: 0, noun: (n) => `${n} ${n === 1 ? 'thread' : 'threads'}` },
  { key: 'contradictions', name: 'CONTRADICTIONS', color: '#B08276', sides: 6, noun: (n) => `${n} ${n === 1 ? 'tension' : 'tensions'}` },
  { key: 'convergence', name: 'CONVERGENCE', color: '#8A7EA6', sides: 3, noun: (n) => `${n} ${n === 1 ? 'signal' : 'signals'}` },
  { key: 'dormant', name: 'DORMANT', color: '#7C7C82', sides: 0, noun: (n) => `${n} dormant` },
];
const META_BY_KEY: Record<RegionKey, RegionMeta> = Object.fromEntries(
  REGION_META.map((m) => [m.key, m]),
) as Record<RegionKey, RegionMeta>;

// Selection type → region (for the detail card's accent colour + label).
const TYPE_TO_KEY: Record<'thread' | 'contradiction' | 'convergence' | 'dormant', RegionKey> = {
  thread: 'threads',
  contradiction: 'contradictions',
  convergence: 'convergence',
  dormant: 'dormant',
};
const TYPE_LABEL: Record<'thread' | 'contradiction' | 'convergence' | 'dormant', string> = {
  thread: 'THREAD',
  contradiction: 'TENSION',
  convergence: 'CONVERGENCE',
  dormant: 'DORMANT',
};

// Slot layouts (normalized) — regions spread far apart, re-centered by count.
const SLOTS: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 0.5, y: 0.5 }],
  2: [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }],
  3: [{ x: 0.5, y: 0.3 }, { x: 0.3, y: 0.72 }, { x: 0.7, y: 0.72 }],
  4: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.3, y: 0.72 }, { x: 0.7, y: 0.72 }],
};

// ── Deterministic helpers ─────────────────────────────────────────────────
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function spiral(cx: number, cy: number, i: number, n: number, maxR: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const t = n <= 1 ? 0 : i / (n - 1);
  const r = maxR * Math.sqrt(t);
  const a = i * golden;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function polygonPath(cx: number, cy: number, r: number, sides: number, rot = 0) {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}
function sizeFor(count: number, max: number, min: number, cap: number) {
  if (max <= 0) return min;
  return min + (Math.min(count, max) / max) * (cap - min);
}
function clampVBX(v: number, vbW: number) {
  const slack = vbW * 0.55;
  return Math.max(-slack, Math.min(CANVAS_W - vbW + slack, v));
}
function clampVBY(v: number, vbH: number) {
  const slack = vbH * 0.55;
  return Math.max(-slack, Math.min(CANVAS_H - vbH + slack, v));
}
function fitTo(cx: number, cy: number, halfW: number, halfH: number, pad: number) {
  const zoom = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, Math.min(SW / (halfW * 2 * pad), SH / (halfH * 2 * pad))),
  );
  const vbW = SW / zoom;
  const vbH = SH / zoom;
  return { x: cx - vbW / 2, y: cy - vbH / 2, zoom };
}

// ── Region content layouts ────────────────────────────────────────────────
type ThreadItem = { id: string; x: number; y: number; r: number; rings: number; d: ThreadSynthesis };
type TensionNode = { id: string; x: number; y: number; label: string };
type TensionEdge = { id: string; a: TensionNode; b: TensionNode; d: ContradictionCard };
type ConvItem = { id: string; x: number; y: number; r: number; streams: { x: number; y: number }[]; d: ConvergenceSignal };
type DormantItem = { id: string; x: number; y: number; dots: { x: number; y: number; r: number }[]; d: DormantThread };

type RegionLayout = {
  threads: { hubX: number; hubY: number; items: ThreadItem[] };
  contradictions: { nodes: TensionNode[]; edges: TensionEdge[] };
  convergence: ConvItem[];
  dormant: DormantItem[];
};

type Model = {
  activeKeys: RegionKey[];
  centers: Map<RegionKey, { cx: number; cy: number }>;
  counts: Record<RegionKey, number>;
  layout: RegionLayout;
};

function buildModel(intel: PersonalIntelligenceResponse): Model {
  const counts: Record<RegionKey, number> = {
    threads: intel.threadSyntheses.length,
    contradictions: intel.contradictionCards.length,
    convergence: intel.convergenceSignals.length,
    dormant: intel.dormantThreads.length,
  };
  const activeKeys = REGION_META.map((m) => m.key).filter((k) => counts[k] > 0);

  const centers = new Map<RegionKey, { cx: number; cy: number }>();
  const slots = SLOTS[activeKeys.length] ?? SLOTS[4];
  activeKeys.forEach((k, i) => {
    const s = slots[i] ?? { x: 0.5, y: 0.5 };
    centers.set(k, { cx: s.x * CANVAS_W, cy: s.y * CANVAS_H });
  });

  // Threads — hub-and-spoke bundle; orb size + tree-ring depth ∝ captureCount.
  const tc = centers.get('threads');
  const threadArr = intel.threadSyntheses.slice(0, 9);
  const maxThread = Math.max(1, ...threadArr.map((t) => t.captureCount));
  const threadItems: ThreadItem[] = tc
    ? threadArr.map((d, i) => {
        const p = spiral(tc.cx, tc.cy, i + 1, threadArr.length + 1, REGION_R * 0.72);
        return {
          id: d.topicId,
          x: p.x,
          y: p.y,
          r: sizeFor(d.captureCount, maxThread, 18, 42),
          rings: Math.min(5, Math.max(1, Math.round((d.captureCount / maxThread) * 5))),
          d,
        };
      })
    : [];

  // Contradictions — a tension network. Shared captures become shared nodes.
  const cc = centers.get('contradictions');
  const tensionNodes: TensionNode[] = [];
  const tensionEdges: TensionEdge[] = [];
  if (cc) {
    const cards = intel.contradictionCards.slice(0, 6);
    const nodeMap = new Map<string, TensionNode>();
    const ids: { id: string; label: string }[] = [];
    for (const card of cards) {
      if (!nodeMap.has(card.itemAId)) ids.push({ id: card.itemAId, label: card.labelA });
      if (!nodeMap.has(card.itemBId)) ids.push({ id: card.itemBId, label: card.labelB });
      nodeMap.set(card.itemAId, {} as TensionNode);
      nodeMap.set(card.itemBId, {} as TensionNode);
    }
    ids.forEach((entry, i) => {
      const p = spiral(cc.cx, cc.cy, i, ids.length, REGION_R * 0.68);
      const node: TensionNode = { id: entry.id, x: p.x, y: p.y, label: entry.label };
      nodeMap.set(entry.id, node);
    });
    for (const card of cards) {
      const a = nodeMap.get(card.itemAId);
      const b = nodeMap.get(card.itemBId);
      if (a && b) tensionEdges.push({ id: `${card.itemAId}-${card.itemBId}`, a, b, d: card });
    }
    tensionNodes.push(...Array.from(nodeMap.values()).filter((n) => typeof n.x === 'number'));
  }

  // Convergence — tributaries streaming into a shared theme (delta).
  const cvc = centers.get('convergence');
  const conv: ConvItem[] = cvc
    ? intel.convergenceSignals.slice(0, 6).map((d, i, arr) => {
        const p = spiral(cvc.cx, cvc.cy, i, arr.length, REGION_R * 0.62);
        const n = Math.max(2, Math.min(6, d.sourceCount));
        const streams = Array.from({ length: n }, (_, k) => {
          const a = (k / n) * Math.PI * 2 + hashId(d.topicId);
          const rr = 90;
          return { x: p.x + rr * Math.cos(a), y: p.y + rr * Math.sin(a) };
        });
        return { id: d.topicId, x: p.x, y: p.y, r: 20, streams, d };
      })
    : [];

  // Dormant — faint constellations that can be reawakened.
  const dc = centers.get('dormant');
  const dormant: DormantItem[] = dc
    ? intel.dormantThreads.slice(0, 8).map((d, i, arr) => {
        const p = spiral(dc.cx, dc.cy, i, arr.length, REGION_R * 0.7);
        const seed = hashId(d.topicId);
        const n = 3 + (seed % 3);
        const dots = Array.from({ length: n }, (_, k) => {
          const a = (k / n) * Math.PI * 2 + seed;
          const rr = 22 + (seed % 20);
          return { x: p.x + rr * Math.cos(a), y: p.y + rr * Math.sin(a), r: 3 + (k % 3) };
        });
        return { id: d.topicId, x: p.x, y: p.y, dots, d };
      })
    : [];

  return {
    activeKeys,
    centers,
    counts,
    layout: {
      threads: { hubX: tc?.cx ?? 0, hubY: tc?.cy ?? 0, items: threadItems },
      contradictions: { nodes: tensionNodes, edges: tensionEdges },
      convergence: conv,
      dormant,
    },
  };
}

function overviewCamera(centers: { cx: number; cy: number }[]) {
  if (centers.length === 0) return fitTo(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W / 2, CANVAS_H / 2, 1.1);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of centers) {
    minX = Math.min(minX, c.cx - REGION_R);
    maxX = Math.max(maxX, c.cx + REGION_R);
    minY = Math.min(minY, c.cy - REGION_R);
    maxY = Math.max(maxY, c.cy + REGION_R);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return fitTo(cx, cy, (maxX - minX) / 2, (maxY - minY) / 2, 1.12);
}

// ── Selection (drives the AI-explanation panel) ───────────────────────────
type Selection =
  | { type: 'thread'; d: ThreadSynthesis }
  | { type: 'contradiction'; d: ContradictionCard }
  | { type: 'convergence'; d: ConvergenceSignal }
  | { type: 'dormant'; d: DormantThread }
  | null;

const EMPTY_INTEL: PersonalIntelligenceResponse = {
  contradictionCards: [], threadSyntheses: [], convergenceSignals: [], dormantThreads: [],
};

export default function MindScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [infoVisible, setInfoVisible] = useState(false);

  const { data, loading, error, refetch } = useApiQuery(() => api.memory.intelligence(), [], { cacheKey: 'memory.intelligence' });
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const model = useMemo(() => buildModel(data ?? EMPTY_INTEL), [data]);
  const hasContent = model.activeKeys.length > 0;
  const overviewCam = useMemo(
    () => overviewCamera(model.activeKeys.map((k) => model.centers.get(k)!)),
    [model],
  );

  // ── Camera (viewBox model, ported from Atlas) ───────────────────────────
  const savedVB = useRef({ x: overviewCam.x, y: overviewCam.y });
  const [vbPos, setVbPos] = useState({ x: overviewCam.x, y: overviewCam.y });
  const savedZoom = useRef(overviewCam.zoom);
  const [zoom, setZoom] = useState(overviewCam.zoom);
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const animCancelRef = useRef<(() => void) | null>(null);
  const momentumFrameRef = useRef<number | null>(null);

  const animateCamera = useCallback((tx: number, ty: number, tz: number, duration = 780) => {
    if (animCancelRef.current) animCancelRef.current();
    const sx = savedVB.current.x;
    const sy = savedVB.current.y;
    const sz = savedZoom.current;
    const start = Date.now();
    let frameId: number;
    let cancelled = false;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const frame = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - start) / duration);
      const e = ease(t);
      const z = sz + (tz - sz) * e;
      const x = clampVBX(sx + (tx - sx) * e, SW / z);
      const y = clampVBY(sy + (ty - sy) * e, SH / z);
      savedVB.current = { x, y };
      savedZoom.current = z;
      setVbPos({ x, y });
      setZoom(z);
      if (t < 1) frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    animCancelRef.current = () => { cancelled = true; cancelAnimationFrame(frameId); };
  }, []);

  const mapPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.touches.length >= 2 || Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3,
      onPanResponderGrant: (evt) => {
        if (animCancelRef.current) animCancelRef.current();
        if (momentumFrameRef.current !== null) {
          cancelAnimationFrame(momentumFrameRef.current);
          momentumFrameRef.current = null;
        }
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          pinchStartRef.current = { dist: Math.hypot(dx, dy), zoom: savedZoom.current };
        }
      },
      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2 && pinchStartRef.current) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.hypot(dx, dy);
          const raw = pinchStartRef.current.zoom * (dist / pinchStartRef.current.dist);
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, raw));
          const mid = {
            x: (touches[0].pageX + touches[1].pageX) / 2,
            y: (touches[0].pageY + touches[1].pageY) / 2,
          };
          const worldX = savedVB.current.x + mid.x / savedZoom.current;
          const worldY = savedVB.current.y + mid.y / savedZoom.current;
          const nx = clampVBX(worldX - mid.x / newZoom, SW / newZoom);
          const ny = clampVBY(worldY - mid.y / newZoom, SH / newZoom);
          savedZoom.current = newZoom;
          savedVB.current = { x: nx, y: ny };
          setZoom(newZoom);
          setVbPos({ x: nx, y: ny });
          return;
        }
        const nx = clampVBX(savedVB.current.x - gs.dx / savedZoom.current, SW / savedZoom.current);
        const ny = clampVBY(savedVB.current.y - gs.dy / savedZoom.current, SH / savedZoom.current);
        setVbPos({ x: nx, y: ny });
      },
      onPanResponderRelease: (evt, gs) => {
        if (pinchStartRef.current) { pinchStartRef.current = null; return; }
        const nx = clampVBX(savedVB.current.x - gs.dx / savedZoom.current, SW / savedZoom.current);
        const ny = clampVBY(savedVB.current.y - gs.dy / savedZoom.current, SH / savedZoom.current);
        savedVB.current = { x: nx, y: ny };
        setVbPos({ x: nx, y: ny });
        let velX = gs.vx * 0.6;
        let velY = gs.vy * 0.6;
        if (Math.hypot(velX, velY) < 0.3) return;
        const step = () => {
          velX *= 0.88;
          velY *= 0.88;
          if (Math.abs(velX) < 0.05 && Math.abs(velY) < 0.05) { momentumFrameRef.current = null; return; }
          const z = savedZoom.current;
          const mx = clampVBX(savedVB.current.x - (velX * 12) / z, SW / z);
          const my = clampVBY(savedVB.current.y - (velY * 12) / z, SH / z);
          savedVB.current = { x: mx, y: my };
          setVbPos({ x: mx, y: my });
          momentumFrameRef.current = requestAnimationFrame(step);
        };
        momentumFrameRef.current = requestAnimationFrame(step);
      },
    }),
  ).current;

  const [active, setActive] = useState<RegionKey | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [reawakened, setReawakened] = useState<Set<string>>(new Set());

  // Snap to the overview once real data first arrives (don't fight the user after).
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current || !hasContent) return;
    initedRef.current = true;
    savedVB.current = { x: overviewCam.x, y: overviewCam.y };
    savedZoom.current = overviewCam.zoom;
    setVbPos({ x: overviewCam.x, y: overviewCam.y });
    setZoom(overviewCam.zoom);
  }, [hasContent, overviewCam]);

  useEffect(() => () => {
    if (animCancelRef.current) animCancelRef.current();
    if (momentumFrameRef.current !== null) cancelAnimationFrame(momentumFrameRef.current);
  }, []);

  const goToRegion = useCallback((key: RegionKey) => {
    const center = model.centers.get(key);
    if (!center) return;
    setActive(key);
    setSelection(null);
    const cam = fitTo(center.cx, center.cy, REGION_R, REGION_R, 1.16);
    animateCamera(cam.x, cam.y, cam.zoom, 820);
  }, [model, animateCamera]);

  const goToOverview = useCallback(() => {
    setActive(null);
    setSelection(null);
    animateCamera(overviewCam.x, overviewCam.y, overviewCam.zoom, 760);
  }, [overviewCam, animateCamera]);

  const reawaken = useCallback((id: string) => {
    setReawakened((prev) => new Set(prev).add(id));
  }, []);

  // ── Deep links (request 5) ──────────────────────────────────────────────
  const continueInCompanion = useCallback((d: ThreadSynthesis) => {
    const prefill =
      `Here's where I seem to have landed on ${d.topicName}: "${d.position}"\n\n` +
      `The open question: ${d.openQuestion}\n\n` +
      `My take: `;
    router.push({
      pathname: '/companion',
      params: {
        contextIds: d.itemIds.join(','),
        contextLabels: d.topicName,
        prefill,
      },
    } as never);
  }, [router]);

  const viewInAtlas = useCallback((d: ThreadSynthesis) => {
    router.navigate({ pathname: '/(tabs)', params: { selectIds: d.itemIds.join(',') } } as never);
  }, [router]);

  const vbW = SW / zoom;
  const vbH = SH / zoom;
  const sx = (wx: number) => (wx - vbPos.x) * zoom;
  const sy = (wy: number) => (wy - vbPos.y) * zoom;
  const labelFont = Math.max(11, Math.min(52, 15 / zoom));
  const subFont = Math.max(8, Math.min(26, 9 / zoom));

  // ── Loading / error / empty ─────────────────────────────────────────────
  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.headerFlat, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">mind</Text>
        </View>
        <AsciiLoader
          fill
          size={96}
          message={['sifting your mind…', 'weighing tensions…', 'connecting the dots…']}
        />
      </SafeAreaView>
    );
  }
  if (error && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.headerFlat, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">mind</Text>
        </View>
        <ScreenIntro title="Mind unavailable" body={error} />
        <Pressable onPress={() => void refetch()} style={styles.retry}>
          <Text variant="monoSmall" style={{ color: c.text }}>retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!hasContent) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.headerFlat, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">mind</Text>
        </View>
        <ScreenIntro
          title="Your mind is quiet for now"
          body="Save a few more things and regions surface here on their own: threads you're chasing, ideas in tension, topics converging or going dormant."
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.mapBackground }]}>
      {/* ── Spatial canvas ─────────────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFill} {...mapPan.panHandlers}>
        <Svg width={SW} height={SH} viewBox={`${vbPos.x} ${vbPos.y} ${vbW} ${vbH}`}>
          <Defs>
            {REGION_META.map((m) => (
              <RadialGradient key={`g-${m.key}`} id={`g-${m.key}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={m.color} stopOpacity={0.12} />
                <Stop offset="62%" stopColor={m.color} stopOpacity={0.035} />
                <Stop offset="100%" stopColor={m.color} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>

          <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={c.mapBackground} />

          {model.activeKeys.map((key) => {
            const m = META_BY_KEY[key];
            const center = model.centers.get(key)!;
            const isActive = active === key;
            const dim = active && !isActive ? 0.26 : 1;
            return (
              <G key={key} opacity={dim}>
                <Circle cx={center.cx} cy={center.cy} r={REGION_R} fill={`url(#g-${key})`} />
                {m.sides === 0 ? (
                  <Circle cx={center.cx} cy={center.cy} r={REGION_R * 0.92} fill="none"
                    stroke={m.color} strokeOpacity={0.2} strokeWidth={1.3} strokeDasharray="2 12" />
                ) : (
                  <Path d={polygonPath(center.cx, center.cy, REGION_R * 0.94, m.sides, hashId(key))}
                    fill="none" stroke={m.color} strokeOpacity={0.2} strokeWidth={1.3} strokeDasharray="2 13" />
                )}

                {key === 'threads' && renderThreads(model.layout, m.color)}
                {key === 'contradictions' && renderContradictions(model.layout, m.color)}
                {key === 'convergence' && renderConvergence(model.layout, m.color)}
                {key === 'dormant' && renderDormant(model.layout, m.color, reawakened)}

                {/* Always-visible region label */}
                <SvgText x={center.cx} y={center.cy - REGION_R * 0.8} fontSize={labelFont}
                  fontFamily={FontFamily.mono} fill={m.color} fillOpacity={0.95} textAnchor="middle" letterSpacing={2}>
                  {m.name}
                </SvgText>
                <SvgText x={center.cx} y={center.cy - REGION_R * 0.8 + labelFont * 1.05} fontSize={subFont}
                  fontFamily={FontFamily.mono} fill={ink(0.4)} textAnchor="middle" letterSpacing={1.5}>
                  {m.noun(model.counts[key])}
                </SvgText>

                {isActive && zoom > 0.4 && renderItemLabels(key, model.layout, subFont)}
              </G>
            );
          })}
        </Svg>

        {/* ── Touch overlay ────────────────────────────────────────────── */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {model.activeKeys.map((key) => {
            if (active === key) return null;
            const center = model.centers.get(key)!;
            const cxs = sx(center.cx);
            const cys = sy(center.cy);
            const rs = REGION_R * zoom;
            if (cxs < -rs || cxs > SW + rs || cys < -rs || cys > SH + rs) return null;
            const size = rs * 1.4;
            return (
              <Pressable key={`hit-${key}`}
                style={{ position: 'absolute', left: cxs - size / 2, top: cys - size / 2, width: size, height: size, borderRadius: size / 2 }}
                onPress={() => goToRegion(key)}
                accessibilityLabel={`${META_BY_KEY[key].name} region`} />
            );
          })}

          {active && renderItemHits(active, model.layout, sx, sy, zoom, {
            selectThread: (d) => setSelection({ type: 'thread', d }),
            selectContradiction: (d) => setSelection({ type: 'contradiction', d }),
            selectConvergence: (d) => setSelection({ type: 'convergence', d }),
            selectDormant: (d) => { reawaken(d.topicId); setSelection({ type: 'dormant', d }); },
          })}
        </View>
      </View>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.headerOverlay}>
        <View style={styles.headerRow} pointerEvents="box-none">
          {active ? (
            <Pressable onPress={goToOverview} hitSlop={12} style={styles.backBtn}>
              <Text variant="monoSmall" style={{ color: ink(0.9) }}>← overview</Text>
            </Pressable>
          ) : (
            <Text variant="wordmark" style={{ color: ink(0.92) }}>mind</Text>
          )}
          <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About mind">
            <Text style={{ color: ink(0.5), fontSize: 16 }}>ⓘ</Text>
          </Pressable>
        </View>
        {active && (
          <Text variant="monoSmall" style={[styles.activeName, { color: ink(0.4) }]}>
            {META_BY_KEY[active].name.toLowerCase()}
          </Text>
        )}
      </SafeAreaView>

      {/* ── Overview hint ─────────────────────────────────────────────────── */}
      {!active && !selection && (
        <View style={styles.legend} pointerEvents="none">
          <Text variant="monoSmall" style={{ color: ink(0.4), letterSpacing: 1 }}>
            tap a region to explore · pinch to zoom
          </Text>
        </View>
      )}

      {/* ── AI-explanation panel ──────────────────────────────────────────── */}
      {selection && (() => {
        const accent = META_BY_KEY[TYPE_TO_KEY[selection.type]].color;
        return (
        <View style={[styles.panel, { backgroundColor: c.background, borderColor: c.border }]}>
          <View style={[styles.panelHandle, { backgroundColor: c.border }]} />

          {/* Identity chip — gives every card a recognizable, non-textual header */}
          <View style={styles.cardHead}>
            <View style={styles.cardHeadLeft}>
              <View style={[styles.cardDot, { backgroundColor: accent }]} />
              <Text variant="monoSmall" style={[styles.cardType, { color: accent }]}>
                {TYPE_LABEL[selection.type]}
              </Text>
            </View>
            <Pressable onPress={() => setSelection(null)} hitSlop={12}>
              <Text variant="monoSmall" color="faint">close</Text>
            </Pressable>
          </View>

          {selection.type === 'thread' && (
            <>
              <PanelMeta left={selection.d.topicName} right={`${selection.d.captureCount} captures`} />
              <View style={[styles.quote, { borderLeftColor: accent }]}>
                <Text variant="body" numberOfLines={5}>{selection.d.position}</Text>
              </View>
              <Text variant="monoSmall" style={[styles.sectionLabel, { color: accent }]}>OPEN QUESTION</Text>
              <Text variant="bodyMedium" numberOfLines={3}>{selection.d.openQuestion}</Text>
              <View style={[styles.ctaRow, { borderTopColor: c.borderSubtle }]}>
                <Pressable onPress={() => continueInCompanion(selection.d)} hitSlop={8}>
                  <Text variant="monoSmall" color="muted">Continue in companion →</Text>
                </Pressable>
                <Pressable onPress={() => viewInAtlas(selection.d)} hitSlop={8}>
                  <Text variant="monoSmall" color="muted">View in Atlas →</Text>
                </Pressable>
              </View>
            </>
          )}
          {selection.type === 'contradiction' && (
            <>
              <View style={styles.pairRow}>
                <Pressable style={[styles.pairBox, { borderColor: c.borderSubtle }]} onPress={() => router.push(`/insight/${selection.d.itemAId}` as never)}>
                  <Text variant="monoSmall" style={{ color: accent }}>A</Text>
                  <Text variant="bodyMedium" numberOfLines={3} style={{ marginTop: 4 }}>{selection.d.labelA}</Text>
                </Pressable>
                <Pressable style={[styles.pairBox, { borderColor: c.borderSubtle }]} onPress={() => router.push(`/insight/${selection.d.itemBId}` as never)}>
                  <Text variant="monoSmall" style={{ color: accent }}>B</Text>
                  <Text variant="bodyMedium" numberOfLines={3} style={{ marginTop: 4 }}>{selection.d.labelB}</Text>
                </Pressable>
              </View>
              <Text variant="monoSmall" style={[styles.sectionLabel, { color: accent }]}>TENSION</Text>
              <Text variant="bodyMedium" numberOfLines={4}>{selection.d.tension}</Text>
            </>
          )}
          {selection.type === 'convergence' && (
            <>
              <PanelMeta left={selection.d.topicName} right={`${selection.d.sourceCount} sources`} />
              <View style={[styles.quote, { borderLeftColor: accent }]}>
                <Text variant="body" numberOfLines={5}>{selection.d.signal}</Text>
              </View>
            </>
          )}
          {selection.type === 'dormant' && (
            <>
              <PanelMeta left={selection.d.topicName} right={`${selection.d.captureCount} captures`} />
              <View style={[styles.quote, { borderLeftColor: accent }]}>
                <Text variant="body" numberOfLines={4}>
                  Quiet for {selection.d.daysSilent} days. You went deep here once — worth reawakening?
                </Text>
              </View>
            </>
          )}
        </View>
        );
      })()}

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="mind"
        body="A map of how you're thinking. Regions appear as they fill in — threads you're chasing, ideas in tension, topics converging, and threads gone dormant. Fly into a region for the detail; tap something for the explanation."
      />
    </View>
  );
}

// ── SVG region renderers ───────────────────────────────────────────────────
function renderThreads(layout: RegionLayout, color: string) {
  const { threads } = layout;
  return (
    <G>
      {threads.items.map((it) => (
        <Line key={`tl-${it.id}`} x1={threads.hubX} y1={threads.hubY} x2={it.x} y2={it.y}
          stroke={color} strokeOpacity={0.32} strokeWidth={1.5} />
      ))}
      {threads.items.map((it, i) => {
        const nxt = threads.items[(i + 1) % threads.items.length];
        if (!nxt || threads.items.length < 3) return null;
        return (
          <Line key={`tb-${it.id}`} x1={it.x} y1={it.y} x2={nxt.x} y2={nxt.y}
            stroke={color} strokeOpacity={0.1} strokeWidth={1} />
        );
      })}
      <Circle cx={threads.hubX} cy={threads.hubY} r={11} fill={color} fillOpacity={0.6} />
      {threads.items.map((it) => (
        <G key={`tn-${it.id}`}>
          {/* tree-ring depth: more rings = deeper investigation */}
          {Array.from({ length: it.rings }, (_, k) => (
            <Circle key={k} cx={it.x} cy={it.y} r={it.r + 6 + k * 7} fill="none"
              stroke={color} strokeOpacity={0.16 - k * 0.02} strokeWidth={1} />
          ))}
          <Circle cx={it.x} cy={it.y} r={it.r} fill={color} fillOpacity={0.82} />
        </G>
      ))}
    </G>
  );
}

function renderContradictions(layout: RegionLayout, color: string) {
  const { contradictions } = layout;
  return (
    <G>
      {contradictions.edges.map((e) => {
        // jagged tension bolt between the two poles
        const mx = (e.a.x + e.b.x) / 2;
        const my = (e.a.y + e.b.y) / 2;
        const nx = -(e.b.y - e.a.y);
        const ny = e.b.x - e.a.x;
        const len = Math.hypot(nx, ny) || 1;
        const off = 11;
        const jx = mx + (nx / len) * off;
        const jy = my + (ny / len) * off;
        return (
          <G key={`ce-${e.id}`}>
            <Path d={`M${e.a.x},${e.a.y}L${jx},${jy}L${e.b.x},${e.b.y}`}
              fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={1.8} />
            {/* spark at the point of tension */}
            <Circle cx={mx} cy={my} r={4.5} fill={color} fillOpacity={0.95} />
          </G>
        );
      })}
      {contradictions.nodes.map((n) => (
        <G key={`cn-${n.id}`}>
          <Circle cx={n.x} cy={n.y} r={26} fill={color} fillOpacity={0.08} />
          <Circle cx={n.x} cy={n.y} r={18} fill={color} fillOpacity={0.82} />
        </G>
      ))}
    </G>
  );
}

function renderConvergence(layout: RegionLayout, color: string) {
  return (
    <G>
      {layout.convergence.map((g) => (
        <G key={`cv-${g.id}`}>
          {g.streams.map((s, i) => {
            // curved tributary flowing toward the shared theme node
            const mx = (s.x + g.x) / 2 + (g.y - s.y) * 0.18;
            const my = (s.y + g.y) / 2 + (s.x - g.x) * 0.18;
            return (
              <G key={i}>
                <Path d={`M${s.x},${s.y}Q${mx},${my} ${g.x},${g.y}`}
                  fill="none" stroke={color} strokeOpacity={0.36} strokeWidth={1.3} />
                <Circle cx={s.x} cy={s.y} r={5.5} fill={color} fillOpacity={0.55} />
              </G>
            );
          })}
          <Circle cx={g.x} cy={g.y} r={g.r * 1.9} fill={color} fillOpacity={0.12} />
          <Circle cx={g.x} cy={g.y} r={g.r} fill={color} fillOpacity={0.88} />
        </G>
      ))}
    </G>
  );
}

function renderDormant(layout: RegionLayout, color: string, reawakened: Set<string>) {
  return (
    <G>
      {layout.dormant.map((d) => {
        const awake = reawakened.has(d.id);
        const op = awake ? 0.75 : 0.3;
        return (
          <G key={`dm-${d.id}`}>
            <Circle cx={d.x} cy={d.y} r={40} fill="none" stroke={color}
              strokeOpacity={awake ? 0.32 : 0.16} strokeWidth={1} strokeDasharray="2 8" />
            {d.dots.map((dot, i) => {
              const nxt = d.dots[(i + 1) % d.dots.length];
              return (
                <G key={i}>
                  {nxt && <Line x1={dot.x} y1={dot.y} x2={nxt.x} y2={nxt.y}
                    stroke={color} strokeOpacity={op * 0.45} strokeWidth={0.9} />}
                  <Circle cx={dot.x} cy={dot.y} r={dot.r + 0.5} fill={color} fillOpacity={op} />
                </G>
              );
            })}
            <Circle cx={d.x} cy={d.y} r={awake ? 9 : 6} fill={color} fillOpacity={awake ? 0.88 : 0.45} />
          </G>
        );
      })}
    </G>
  );
}

function renderItemLabels(key: RegionKey, layout: RegionLayout, font: number) {
  const label = (x: number, y: number, txt: string) => (
    <SvgText x={x} y={y} fontSize={font} fontFamily={FontFamily.mono}
      fill={ink(0.62)} textAnchor="middle" letterSpacing={0.5}>
      {txt.length > 18 ? `${txt.slice(0, 17)}…` : txt}
    </SvgText>
  );
  // Labels sit clear of each item's outermost mark (rings / glow / constellation)
  // so dots and strokes never bleed into the text.
  if (key === 'threads') return <G>{layout.threads.items.map((it) => <G key={it.id}>{label(it.x, it.y + it.r + 6 + Math.max(0, it.rings - 1) * 7 + font * 1.3, it.d.topicName)}</G>)}</G>;
  if (key === 'convergence') return <G>{layout.convergence.map((g) => <G key={g.id}>{label(g.x, g.y + g.r * 1.9 + font * 1.3, g.d.topicName)}</G>)}</G>;
  if (key === 'dormant') return <G>{layout.dormant.map((d) => <G key={d.id}>{label(d.x, d.y + 40 + font * 1.3, d.d.topicName)}</G>)}</G>;
  return null;
}

function renderItemHits(
  key: RegionKey,
  layout: RegionLayout,
  sx: (n: number) => number,
  sy: (n: number) => number,
  zoom: number,
  cb: {
    selectThread: (d: ThreadSynthesis) => void;
    selectContradiction: (d: ContradictionCard) => void;
    selectConvergence: (d: ConvergenceSignal) => void;
    selectDormant: (d: DormantThread) => void;
  },
) {
  const hit = (id: string, wx: number, wy: number, r: number, onPress: () => void) => {
    const x = sx(wx);
    const y = sy(wy);
    const s = Math.max(46, r * zoom * 2.4);
    if (x < -s || x > SW + s || y < -s || y > SH + s) return null;
    return (
      <Pressable key={id}
        style={{ position: 'absolute', left: x - s / 2, top: y - s / 2, width: s, height: s, borderRadius: s / 2 }}
        onPress={onPress} />
    );
  };
  if (key === 'threads') return <>{layout.threads.items.map((it) => hit(`h-${it.id}`, it.x, it.y, it.r, () => cb.selectThread(it.d)))}</>;
  if (key === 'contradictions') {
    // Both the tension poles (the visible circles) and the spark at the middle
    // of each bolt open the card — tapping any part of a tension resolves.
    const { nodes, edges } = layout.contradictions;
    const nodeHits = nodes.map((n) => {
      const edge = edges.find((e) => e.a.id === n.id || e.b.id === n.id);
      if (!edge) return null;
      return hit(`hn-${n.id}`, n.x, n.y, 18, () => cb.selectContradiction(edge.d));
    });
    const edgeHits = edges.map((e) =>
      hit(`he-${e.id}`, (e.a.x + e.b.x) / 2, (e.a.y + e.b.y) / 2, 22, () => cb.selectContradiction(e.d)),
    );
    return <>{nodeHits}{edgeHits}</>;
  }
  if (key === 'convergence') return <>{layout.convergence.map((g) => hit(`h-${g.id}`, g.x, g.y, g.r, () => cb.selectConvergence(g.d)))}</>;
  if (key === 'dormant') return <>{layout.dormant.map((d) => hit(`h-${d.id}`, d.x, d.y, 26, () => cb.selectDormant(d.d)))}</>;
  return null;
}

function PanelMeta({ left, right }: { left: string; right: string }) {
  return (
    <View style={styles.panelMeta}>
      <Text variant="monoSmall" color="muted">{left}</Text>
      <Text variant="monoSmall" color="muted">{right}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  headerFlat: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[4], borderBottomWidth: 1,
  },
  retry: { alignSelf: 'center', marginTop: Spacing[4] },

  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingTop: Spacing[3], paddingBottom: Spacing[2],
  },
  backBtn: { paddingVertical: 2 },
  activeName: { paddingHorizontal: Spacing[6], letterSpacing: 2, textTransform: 'uppercase' },

  legend: {
    position: 'absolute', bottom: Platform.OS === 'ios' ? 100 : 82,
    left: 0, right: 0, alignItems: 'center',
  },

  panel: {
    position: 'absolute', left: Spacing[4], right: Spacing[4],
    bottom: Platform.OS === 'ios' ? 96 : 78,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: Spacing[4],
  },
  panelHandle: { alignSelf: 'center', width: 34, height: 3, borderRadius: 2, marginBottom: Spacing[3] },
  cardHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: Spacing[2],
  },
  cardHeadLeft: { flexDirection: 'row', alignItems: 'center' },
  cardDot: { width: 7, height: 7, borderRadius: 4, marginRight: Spacing[2] },
  cardType: { letterSpacing: 2 },
  panelMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  quote: {
    marginTop: Spacing[3], marginBottom: Spacing[1],
    paddingLeft: Spacing[3], borderLeftWidth: 2,
  },
  sectionLabel: { letterSpacing: 1.5, marginTop: Spacing[4], marginBottom: Spacing[1] },
  ctaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: Spacing[4], paddingTop: Spacing[3], borderTopWidth: StyleSheet.hairlineWidth,
  },
  pairRow: { flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[2] },
  pairBox: {
    flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10,
    padding: Spacing[3],
  },
});
