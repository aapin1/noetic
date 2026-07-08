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
import { SkeletonCard } from '@/components/ui/Skeleton';
import type {
  ContradictionCard,
  ConvergenceSignal,
  DormantThread,
  EvolutionArc,
  EvolutionPeriod,
  PersonalIntelligenceResponse,
  ThreadSynthesis,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────
// The Mind is a single spatial canvas (a companion to Atlas). It reuses the
// Atlas camera model: an SVG viewBox driven by a pannable/pinchable camera and
// a requestAnimationFrame `animateCamera` tween for Google-Maps-style flights.
// Five cognitive regions live at fixed positions on a large world canvas.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');
const MAP_BG = '#070707';
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3.0;

// World canvas — regions are placed in absolute world coordinates so the
// layout is stable regardless of screen size (the camera fits it to screen).
const CANVAS_W = 2640;
const CANVAS_H = 2520;
const REGION_R = 430;

type RegionKey = 'threads' | 'evolution' | 'contradictions' | 'convergence' | 'dormant';

type RegionDef = {
  key: RegionKey;
  name: string;
  color: string;
  cx: number;
  cy: number;
  sides: number; // geometric boundary sides (0 = organic circle)
};

const REGIONS: RegionDef[] = [
  { key: 'threads', name: 'THREADS', color: '#6B9FD4', cx: 730, cy: 660, sides: 0 },
  { key: 'evolution', name: 'EVOLUTION', color: '#7EC8A0', cx: 1910, cy: 620, sides: 4 },
  { key: 'convergence', name: 'CONVERGENCE', color: '#9B84CC', cx: 1320, cy: 1250, sides: 3 },
  { key: 'contradictions', name: 'CONTRADICTIONS', color: '#E8896B', cx: 720, cy: 1840, sides: 6 },
  { key: 'dormant', name: 'DORMANT', color: '#7A7A82', cx: 1930, cy: 1880, sides: 0 },
];

const REGION_BY_KEY: Record<RegionKey, RegionDef> = Object.fromEntries(
  REGIONS.map((r) => [r.key, r]),
) as Record<RegionKey, RegionDef>;

// ── Small deterministic helpers ───────────────────────────────────────────
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Golden-angle spiral — spreads N items organically inside a disc.
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

function sizeFor(count: number, max: number, min = 12, cap = 34) {
  if (max <= 0) return min;
  return min + (Math.min(count, max) / max) * (cap - min);
}

function clampVBX(v: number, vbW: number) {
  // Allow some over-pan so edge regions can be centered even when the fitted
  // zoom makes a region wider than the canvas — but never enough to lose the
  // canvas entirely.
  const slack = vbW * 0.55;
  return Math.max(-slack, Math.min(CANVAS_W - vbW + slack, v));
}
function clampVBY(v: number, vbH: number) {
  const slack = vbH * 0.55;
  return Math.max(-slack, Math.min(CANVAS_H - vbH + slack, v));
}

// Camera fit for a centered bounding box (halfW/halfH in world units).
function fitTo(cx: number, cy: number, halfW: number, halfH: number, pad: number) {
  const zoom = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, Math.min(SW / (halfW * 2 * pad), SH / (halfH * 2 * pad))),
  );
  const vbW = SW / zoom;
  const vbH = SH / zoom;
  return { x: cx - vbW / 2, y: cy - vbH / 2, zoom };
}

const OVERVIEW = fitTo(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W / 2, CANVAS_H / 2, 1.06);
function regionCamera(r: RegionDef) {
  return fitTo(r.cx, r.cy, REGION_R, REGION_R, 1.16);
}

// ── Per-region world layout (computed once from data) ─────────────────────
type ThreadItem = { id: string; x: number; y: number; r: number; d: ThreadSynthesis };
type PairItem = { id: string; ax: number; ay: number; bx: number; by: number; d: ContradictionCard };
type ConvItem = {
  id: string; x: number; y: number; r: number;
  sources: { x: number; y: number }[]; d: ConvergenceSignal;
};
type DormantItem = {
  id: string; x: number; y: number; dots: { x: number; y: number; r: number }[]; d: DormantThread;
};
type EvoTrack = {
  id: string; y: number; arc: EvolutionArc;
  dots: { x: number; r: number; period: EvolutionPeriod }[];
};

type Layout = {
  threads: { hubX: number; hubY: number; items: ThreadItem[] };
  contradictions: PairItem[];
  convergence: ConvItem[];
  dormant: DormantItem[];
  evolution: { left: number; right: number; tracks: EvoTrack[] };
};

function buildLayout(intel: PersonalIntelligenceResponse): Layout {
  const rThreads = REGION_BY_KEY.threads;
  const threadArr = intel.threadSyntheses.slice(0, 9);
  const maxThread = Math.max(1, ...threadArr.map((t) => t.captureCount));
  const threadItems: ThreadItem[] = threadArr.map((d, i) => {
    const p = spiral(rThreads.cx, rThreads.cy, i + 1, threadArr.length + 1, REGION_R * 0.78);
    return { id: d.topicId, x: p.x, y: p.y, r: sizeFor(d.captureCount, maxThread, 16, 40), d };
  });

  const rC = REGION_BY_KEY.contradictions;
  const pairs: PairItem[] = intel.contradictionCards.slice(0, 7).map((d, i, arr) => {
    const p = spiral(rC.cx, rC.cy, i, arr.length, REGION_R * 0.72);
    const seed = hashId(d.itemAId) % 100;
    const spread = 46 + (seed % 30);
    return {
      id: `${d.itemAId}-${d.itemBId}`,
      ax: p.x - spread, ay: p.y - 12 + (seed % 16),
      bx: p.x + spread, by: p.y + 12 - (seed % 16),
      d,
    };
  });

  const rConv = REGION_BY_KEY.convergence;
  const conv: ConvItem[] = intel.convergenceSignals.slice(0, 6).map((d, i, arr) => {
    const p = spiral(rConv.cx, rConv.cy, i, arr.length, REGION_R * 0.66);
    const n = Math.max(2, Math.min(5, d.sourceCount));
    const sources = Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2 + hashId(d.topicId);
      const rr = 74;
      return { x: p.x + rr * Math.cos(a), y: p.y + rr * Math.sin(a) };
    });
    return { id: d.topicId, x: p.x, y: p.y, r: 18, sources, d };
  });

  const rD = REGION_BY_KEY.dormant;
  const dormant: DormantItem[] = intel.dormantThreads.slice(0, 8).map((d, i, arr) => {
    const p = spiral(rD.cx, rD.cy, i, arr.length, REGION_R * 0.74);
    const seed = hashId(d.topicId);
    const n = 3 + (seed % 3);
    const dots = Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2 + seed;
      const rr = 20 + (seed % 18);
      return { x: p.x + rr * Math.cos(a), y: p.y + rr * Math.sin(a), r: 3 + (k % 3) };
    });
    return { id: d.topicId, x: p.x, y: p.y, dots, d };
  });

  const rE = REGION_BY_KEY.evolution;
  const arcs = intel.evolutionArcs.slice(0, 5);
  const left = rE.cx - REGION_R * 0.74;
  const right = rE.cx + REGION_R * 0.74;
  const width = right - left;
  const maxPeriodCount = Math.max(
    1,
    ...arcs.flatMap((a) => a.periods.map((p) => p.captureCount)),
  );
  const totalH = REGION_R * 1.15;
  const spacing = arcs.length > 0 ? totalH / arcs.length : 0;
  const evoTracks: EvoTrack[] = arcs.map((arc, i) => {
    const y = rE.cy - totalH / 2 + spacing * (i + 0.5);
    const maxLen = Math.max(1, arc.periods.length);
    const dots = arc.periods.map((period, j) => ({
      x: maxLen <= 1 ? rE.cx : left + (j / (maxLen - 1)) * width,
      r: sizeFor(period.captureCount, maxPeriodCount, 5, 22),
      period,
    }));
    return { id: arc.topicId, y, arc, dots };
  });

  return {
    threads: { hubX: rThreads.cx, hubY: rThreads.cy, items: threadItems },
    contradictions: pairs,
    convergence: conv,
    dormant,
    evolution: { left, right, tracks: evoTracks },
  };
}

// ── Selection (drives the AI-explanation panel) ───────────────────────────
type Selection =
  | { type: 'thread'; d: ThreadSynthesis }
  | { type: 'contradiction'; d: ContradictionCard }
  | { type: 'convergence'; d: ConvergenceSignal }
  | { type: 'dormant'; d: DormantThread }
  | { type: 'evolution'; arc: EvolutionArc; period: EvolutionPeriod }
  | null;

export default function MindScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [infoVisible, setInfoVisible] = useState(false);

  const { data, loading, error, refetch } = useApiQuery(() => api.memory.intelligence(), []);
  const { data: positions, refetch: refetchPositions } = useApiQuery(() => api.positions.list(), []);

  useFocusEffect(
    useCallback(() => {
      void refetch();
      void refetchPositions();
    }, [refetch, refetchPositions]),
  );

  const positionByTopic = useMemo(
    () => new Map((positions ?? []).map((p) => [p.topicId, p] as const)),
    [positions],
  );

  const counts = useMemo(
    () => ({
      threads: data?.threadSyntheses.length ?? 0,
      evolution: data?.evolutionArcs.length ?? 0,
      contradictions: data?.contradictionCards.length ?? 0,
      convergence: data?.convergenceSignals.length ?? 0,
      dormant: data?.dormantThreads.length ?? 0,
    }),
    [data],
  );
  const hasContent = Object.values(counts).some((n) => n > 0);

  const layout = useMemo(
    () =>
      buildLayout(
        data ?? {
          contradictionCards: [], threadSyntheses: [], convergenceSignals: [],
          evolutionArcs: [], dormantThreads: [],
        },
      ),
    [data],
  );

  // ── Camera (viewBox model, ported from Atlas) ───────────────────────────
  const savedVB = useRef({ x: OVERVIEW.x, y: OVERVIEW.y });
  const [vbPos, setVbPos] = useState({ x: OVERVIEW.x, y: OVERVIEW.y });
  const savedZoom = useRef(OVERVIEW.zoom);
  const [zoom, setZoom] = useState(OVERVIEW.zoom);
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const animCancelRef = useRef<(() => void) | null>(null);
  const momentumFrameRef = useRef<number | null>(null);

  const animateCamera = useCallback(
    (tx: number, ty: number, tz: number, duration = 780) => {
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
      animCancelRef.current = () => {
        cancelled = true;
        cancelAnimationFrame(frameId);
      };
    },
    [],
  );

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
        if (pinchStartRef.current) {
          pinchStartRef.current = null;
          return;
        }
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
          if (Math.abs(velX) < 0.05 && Math.abs(velY) < 0.05) {
            momentumFrameRef.current = null;
            return;
          }
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

  // ── Region focus / selection ────────────────────────────────────────────
  const [active, setActive] = useState<RegionKey | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [reawakened, setReawakened] = useState<Set<string>>(new Set());
  const [scrubPct, setScrubPct] = useState(1);

  const goToRegion = useCallback(
    (key: RegionKey) => {
      setActive(key);
      setSelection(null);
      const cam = regionCamera(REGION_BY_KEY[key]);
      animateCamera(cam.x, cam.y, cam.zoom, 820);
    },
    [animateCamera],
  );

  const goToOverview = useCallback(() => {
    setActive(null);
    setSelection(null);
    animateCamera(OVERVIEW.x, OVERVIEW.y, OVERVIEW.zoom, 760);
  }, [animateCamera]);

  const reawaken = useCallback((id: string) => {
    setReawakened((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Evolution scrubber (its own PanResponder over a bottom rail).
  const scrubRailW = SW - Spacing[6] * 2;
  const scrub = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        setScrubPct(Math.max(0, Math.min(1, x / scrubRailW)));
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        setScrubPct(Math.max(0, Math.min(1, x / scrubRailW)));
      },
    }),
  ).current;

  // Cleanup rAF on unmount.
  useEffect(
    () => () => {
      if (animCancelRef.current) animCancelRef.current();
      if (momentumFrameRef.current !== null) cancelAnimationFrame(momentumFrameRef.current);
    },
    [],
  );

  const vbW = SW / zoom;
  const vbH = SH / zoom;
  const sx = (wx: number) => (wx - vbPos.x) * zoom;
  const sy = (wy: number) => (wy - vbPos.y) * zoom;

  // Region label font grows as you zoom out so it stays screen-legible.
  const labelFont = Math.max(11, Math.min(58, 15 / zoom));
  const subFont = Math.max(8, Math.min(30, 9 / zoom));

  // ── Loading / error / empty ─────────────────────────────────────────────
  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">mind</Text>
        </View>
        <SkeletonCard />
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
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
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">mind</Text>
        </View>
        <ScreenIntro
          title="Your mind is quiet for now"
          body="Save a few more things and this space fills in: threads you're chasing, ideas that contradict, topics converging and going dormant."
        />
      </SafeAreaView>
    );
  }

  const evo = layout.evolution;
  const scrubWorldX = evo.left + scrubPct * (evo.right - evo.left);

  return (
    <View style={styles.root}>
      {/* ── Spatial canvas ─────────────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFill} {...mapPan.panHandlers}>
        <Svg width={SW} height={SH} viewBox={`${vbPos.x} ${vbPos.y} ${vbW} ${vbH}`}>
          <Defs>
            {REGIONS.map((r) => (
              <RadialGradient key={`g-${r.key}`} id={`g-${r.key}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={r.color} stopOpacity={0.16} />
                <Stop offset="60%" stopColor={r.color} stopOpacity={0.05} />
                <Stop offset="100%" stopColor={r.color} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>

          <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={MAP_BG} />

          {REGIONS.map((r) => {
            const dim = active && active !== r.key ? 0.28 : 1;
            const isActive = active === r.key;
            const cnt = counts[r.key];
            return (
              <G key={r.key} opacity={dim}>
                {/* Region halo + boundary */}
                <Circle cx={r.cx} cy={r.cy} r={REGION_R} fill={`url(#g-${r.key})`} />
                {r.sides === 0 ? (
                  <Circle
                    cx={r.cx}
                    cy={r.cy}
                    r={REGION_R * 0.92}
                    fill="none"
                    stroke={r.color}
                    strokeOpacity={0.22}
                    strokeWidth={1.4}
                    strokeDasharray="2 10"
                  />
                ) : (
                  <Path
                    d={polygonPath(r.cx, r.cy, REGION_R * 0.94, r.sides, hashId(r.key))}
                    fill="none"
                    stroke={r.color}
                    strokeOpacity={0.22}
                    strokeWidth={1.4}
                    strokeDasharray="2 12"
                  />
                )}

                {/* Region contents */}
                {r.key === 'threads' &&
                  renderThreads(layout, isActive, r.color)}
                {r.key === 'contradictions' &&
                  renderContradictions(layout, r.color)}
                {r.key === 'convergence' &&
                  renderConvergence(layout, r.color)}
                {r.key === 'dormant' &&
                  renderDormant(layout, r.color, reawakened)}
                {r.key === 'evolution' &&
                  renderEvolution(layout, r.color, isActive, scrubWorldX)}

                {/* Always-visible region label */}
                <SvgText
                  x={r.cx}
                  y={r.cy - REGION_R * 0.78}
                  fontSize={labelFont}
                  fontFamily={FontFamily.mono}
                  fill={r.color}
                  fillOpacity={0.92}
                  textAnchor="middle"
                  letterSpacing={2}
                >
                  {r.name}
                </SvgText>
                <SvgText
                  x={r.cx}
                  y={r.cy - REGION_R * 0.78 + labelFont * 1.05}
                  fontSize={subFont}
                  fontFamily={FontFamily.mono}
                  fill="#FFFFFF"
                  fillOpacity={0.35}
                  textAnchor="middle"
                  letterSpacing={1.5}
                >
                  {cnt === 0 ? 'quiet' : `${cnt} ${cnt === 1 ? 'signal' : 'signals'}`}
                </SvgText>

                {/* Item labels only when this region is active & zoomed in */}
                {isActive && zoom > 0.4 && renderItemLabels(r.key, layout, subFont)}
              </G>
            );
          })}
        </Svg>

        {/* ── Touch overlay (screen-space Pressables) ──────────────────── */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Non-active regions: one tap flies you there */}
          {REGIONS.map((r) => {
            if (active === r.key) return null;
            const cxs = sx(r.cx);
            const cys = sy(r.cy);
            const rs = REGION_R * zoom;
            if (cxs < -rs || cxs > SW + rs || cys < -rs || cys > SH + rs) return null;
            const size = rs * 1.4;
            return (
              <Pressable
                key={`hit-${r.key}`}
                style={{ position: 'absolute', left: cxs - size / 2, top: cys - size / 2, width: size, height: size, borderRadius: size / 2 }}
                onPress={() => goToRegion(r.key)}
                accessibilityLabel={`${r.name} region`}
              />
            );
          })}

          {/* Active region: per-item taps */}
          {active && renderItemHits(active, layout, sx, sy, zoom, {
            selectThread: (d) => setSelection({ type: 'thread', d }),
            selectContradiction: (d) => setSelection({ type: 'contradiction', d }),
            selectConvergence: (d) => setSelection({ type: 'convergence', d }),
            selectDormant: (d) => { reawaken(d.topicId); setSelection({ type: 'dormant', d }); },
            selectEvolution: (arc, period) => setSelection({ type: 'evolution', arc, period }),
          })}
        </View>
      </View>

      {/* ── Header (fades minimal when a region is active) ───────────────── */}
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.headerOverlay}>
        <View style={styles.headerRow} pointerEvents="box-none">
          {active ? (
            <Pressable onPress={goToOverview} hitSlop={12} style={styles.backBtn}>
              <Text variant="monoSmall" style={{ color: '#ECECEC' }}>← overview</Text>
            </Pressable>
          ) : (
            <Text variant="wordmark" style={{ color: '#ECECEC' }}>mind</Text>
          )}
          <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About mind">
            <Text style={{ color: 'rgba(236,236,236,0.5)', fontSize: 16 }}>ⓘ</Text>
          </Pressable>
        </View>
        {active && (
          <Text variant="monoSmall" style={styles.activeName}>
            {REGION_BY_KEY[active].name.toLowerCase()}
          </Text>
        )}
      </SafeAreaView>

      {/* ── Evolution scrubber ──────────────────────────────────────────── */}
      {active === 'evolution' && counts.evolution > 0 && (
        <View style={[styles.scrubWrap, { width: scrubRailW }]}>
          <Text variant="monoSmall" style={styles.scrubHint}>drag to scrub through time</Text>
          <View style={styles.scrubRail} {...scrub.panHandlers}>
            <View style={styles.scrubTrack} />
            <View style={[styles.scrubFill, { width: scrubPct * scrubRailW }]} />
            <View style={[styles.scrubThumb, { left: scrubPct * scrubRailW - 8 }]} />
          </View>
        </View>
      )}

      {/* ── Region legend (overview only) ───────────────────────────────── */}
      {!active && (
        <View style={styles.legend} pointerEvents="none">
          <Text variant="monoSmall" style={styles.legendText}>
            tap a region to explore · pinch to zoom
          </Text>
        </View>
      )}

      {/* ── AI-explanation panel (only on intentional selection) ─────────── */}
      {selection && (
        <View style={styles.panel}>
          <View style={styles.panelHandle} />
          {selection.type === 'thread' && (
            <>
              <PanelMeta left={selection.d.topicName} right={`${selection.d.captureCount} captures`} />
              <Text style={styles.panelBody}>{selection.d.position}</Text>
              <Text style={styles.panelSub}>Open question — {selection.d.openQuestion}</Text>
              <Pressable
                onPress={() => {
                  const pos = positionByTopic.get(selection.d.topicId);
                  if (pos) {
                    router.push({ pathname: '/position/[topicId]' as never, params: { topicId: selection.d.topicId } });
                  } else {
                    router.push({
                      pathname: '/position/create' as never,
                      params: {
                        topicId: selection.d.topicId,
                        topicName: selection.d.topicName,
                        captureCount: String(selection.d.captureCount),
                      },
                    });
                  }
                }}
                style={styles.panelCta}
              >
                <Text style={styles.panelCtaText}>
                  {positionByTopic.get(selection.d.topicId) ? 'View position →' : 'Take a position →'}
                </Text>
              </Pressable>
            </>
          )}
          {selection.type === 'contradiction' && (
            <>
              <View style={styles.pairRow}>
                <Pressable style={styles.pairSide} onPress={() => router.push(`/insight/${selection.d.itemAId}` as never)}>
                  <Text style={styles.pairTag}>A</Text>
                  <Text style={styles.panelBody} numberOfLines={3}>{selection.d.labelA}</Text>
                </Pressable>
                <Pressable style={styles.pairSide} onPress={() => router.push(`/insight/${selection.d.itemBId}` as never)}>
                  <Text style={styles.pairTag}>B</Text>
                  <Text style={styles.panelBody} numberOfLines={3}>{selection.d.labelB}</Text>
                </Pressable>
              </View>
              <Text style={styles.panelSub}>Tension — {selection.d.tension}</Text>
            </>
          )}
          {selection.type === 'convergence' && (
            <>
              <PanelMeta left={selection.d.topicName} right={`${selection.d.sourceCount} sources`} />
              <Text style={styles.panelBody}>{selection.d.signal}</Text>
            </>
          )}
          {selection.type === 'dormant' && (
            <>
              <PanelMeta left={selection.d.topicName} right={`${selection.d.captureCount} captures`} />
              <Text style={styles.panelBody}>
                Quiet for {selection.d.daysSilent} days. You went deep here once — worth a revisit?
              </Text>
            </>
          )}
          {selection.type === 'evolution' && (
            <>
              <PanelMeta left={selection.arc.topicName} right={selection.period.month} />
              <Text style={styles.panelBody}>
                {selection.period.captureCount} captures that month
                {selection.period.keyIdeas.length > 0 ? ` · ${selection.period.keyIdeas[0]}` : ''}
              </Text>
            </>
          )}
          <Pressable onPress={() => setSelection(null)} style={styles.panelClose} hitSlop={12}>
            <Text style={styles.panelCloseText}>close</Text>
          </Pressable>
        </View>
      )}

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="mind"
        body="A map of how you're thinking. Five regions — threads you're chasing, how they've evolved, where they contradict, where they converge, and what's gone dormant. Fly into a region to see the detail; tap something for the explanation."
      />
    </View>
  );
}

// ── SVG region renderers ───────────────────────────────────────────────────
function renderThreads(layout: Layout, isActive: boolean, color: string) {
  const { threads } = layout;
  return (
    <G>
      {threads.items.map((it) => (
        <Line
          key={`tl-${it.id}`}
          x1={threads.hubX} y1={threads.hubY} x2={it.x} y2={it.y}
          stroke={color} strokeOpacity={isActive ? 0.4 : 0.18} strokeWidth={1.1}
        />
      ))}
      {/* faint bundle links between neighbours */}
      {threads.items.map((it, i) => {
        const nxt = threads.items[(i + 1) % threads.items.length];
        if (!nxt || threads.items.length < 3) return null;
        return (
          <Line key={`tb-${it.id}`} x1={it.x} y1={it.y} x2={nxt.x} y2={nxt.y}
            stroke={color} strokeOpacity={0.08} strokeWidth={0.8} />
        );
      })}
      <Circle cx={threads.hubX} cy={threads.hubY} r={10} fill={color} fillOpacity={0.5} />
      {threads.items.map((it) => (
        <G key={`tn-${it.id}`}>
          <Circle cx={it.x} cy={it.y} r={it.r * 1.7} fill={color} fillOpacity={0.08} />
          <Circle cx={it.x} cy={it.y} r={it.r} fill={color} fillOpacity={0.78} />
        </G>
      ))}
    </G>
  );
}

function renderContradictions(layout: Layout, color: string) {
  return (
    <G>
      {layout.contradictions.map((p) => {
        // jagged tension line between the pair
        const mx = (p.ax + p.bx) / 2;
        const my = (p.ay + p.by) / 2;
        const nx = -(p.by - p.ay);
        const ny = p.bx - p.ax;
        const len = Math.hypot(nx, ny) || 1;
        const off = 9;
        const jx = mx + (nx / len) * off;
        const jy = my + (ny / len) * off;
        return (
          <G key={`cn-${p.id}`}>
            <Path d={`M${p.ax},${p.ay}L${jx},${jy}L${p.bx},${p.by}`}
              fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.3} />
            <Circle cx={p.ax} cy={p.ay} r={15} fill={color} fillOpacity={0.7} />
            <Circle cx={p.bx} cy={p.by} r={15} fill={color} fillOpacity={0.7} />
          </G>
        );
      })}
    </G>
  );
}

function renderConvergence(layout: Layout, color: string) {
  return (
    <G>
      {layout.convergence.map((g) => (
        <G key={`cv-${g.id}`}>
          {g.sources.map((s, i) => (
            <G key={i}>
              <Line x1={s.x} y1={s.y} x2={g.x} y2={g.y} stroke={color} strokeOpacity={0.3} strokeWidth={1} />
              <Circle cx={s.x} cy={s.y} r={5} fill={color} fillOpacity={0.5} />
            </G>
          ))}
          <Circle cx={g.x} cy={g.y} r={g.r * 1.9} fill={color} fillOpacity={0.1} />
          <Circle cx={g.x} cy={g.y} r={g.r} fill={color} fillOpacity={0.82} />
        </G>
      ))}
    </G>
  );
}

function renderDormant(layout: Layout, color: string, reawakened: Set<string>) {
  return (
    <G>
      {layout.dormant.map((d) => {
        const awake = reawakened.has(d.id);
        const op = awake ? 0.7 : 0.24;
        return (
          <G key={`dm-${d.id}`}>
            {d.dots.map((dot, i) => {
              const nxt = d.dots[(i + 1) % d.dots.length];
              return (
                <G key={i}>
                  {nxt && (
                    <Line x1={dot.x} y1={dot.y} x2={nxt.x} y2={nxt.y}
                      stroke={color} strokeOpacity={op * 0.4} strokeWidth={0.7} />
                  )}
                  <Circle cx={dot.x} cy={dot.y} r={dot.r} fill={color} fillOpacity={op} />
                </G>
              );
            })}
            <Circle cx={d.x} cy={d.y} r={awake ? 8 : 5} fill={color} fillOpacity={awake ? 0.85 : 0.4} />
          </G>
        );
      })}
    </G>
  );
}

function renderEvolution(layout: Layout, color: string, isActive: boolean, scrubWorldX: number) {
  const { evolution } = layout;
  return (
    <G>
      {isActive && (
        <Line x1={scrubWorldX} y1={REGION_BY_KEY.evolution.cy - REGION_R * 0.7}
          x2={scrubWorldX} y2={REGION_BY_KEY.evolution.cy + REGION_R * 0.7}
          stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 5" />
      )}
      {evolution.tracks.map((t) => (
        <G key={`ev-${t.id}`}>
          <Line x1={evolution.left} y1={t.y} x2={evolution.right} y2={t.y}
            stroke={color} strokeOpacity={0.16} strokeWidth={1} />
          {t.dots.map((dot, i) => {
            const near = isActive && Math.abs(dot.x - scrubWorldX) < 40;
            return (
              <Circle key={i} cx={dot.x} cy={t.y} r={near ? dot.r * 1.4 : dot.r}
                fill={color} fillOpacity={near ? 0.95 : 0.6} />
            );
          })}
        </G>
      ))}
    </G>
  );
}

function renderItemLabels(key: RegionKey, layout: Layout, font: number) {
  const props = (x: number, y: number, txt: string) => (
    <SvgText x={x} y={y} fontSize={font} fontFamily={FontFamily.mono}
      fill="#FFFFFF" fillOpacity={0.6} textAnchor="middle" letterSpacing={0.5}>
      {txt.length > 18 ? `${txt.slice(0, 17)}…` : txt}
    </SvgText>
  );
  if (key === 'threads') return <G>{layout.threads.items.map((it) => <G key={it.id}>{props(it.x, it.y + it.r + font * 1.1, it.d.topicName)}</G>)}</G>;
  if (key === 'convergence') return <G>{layout.convergence.map((g) => <G key={g.id}>{props(g.x, g.y + g.r + font * 1.6, g.d.topicName)}</G>)}</G>;
  if (key === 'dormant') return <G>{layout.dormant.map((d) => <G key={d.id}>{props(d.x, d.y + font * 2.4, d.d.topicName)}</G>)}</G>;
  if (key === 'evolution') return <G>{layout.evolution.tracks.map((t) => <G key={t.id}>{props(layout.evolution.left - 4, t.y + font * 0.35, t.arc.topicName)}</G>)}</G>;
  return null;
}

// ── Screen-space hit targets for the active region ─────────────────────────
function renderItemHits(
  key: RegionKey,
  layout: Layout,
  sx: (n: number) => number,
  sy: (n: number) => number,
  zoom: number,
  cb: {
    selectThread: (d: ThreadSynthesis) => void;
    selectContradiction: (d: ContradictionCard) => void;
    selectConvergence: (d: ConvergenceSignal) => void;
    selectDormant: (d: DormantThread) => void;
    selectEvolution: (arc: EvolutionArc, period: EvolutionPeriod) => void;
  },
) {
  const hit = (id: string, wx: number, wy: number, r: number, onPress: () => void) => {
    const x = sx(wx);
    const y = sy(wy);
    const s = Math.max(38, r * zoom * 2.4);
    if (x < -s || x > SW + s || y < -s || y > SH + s) return null;
    return (
      <Pressable
        key={id}
        style={{ position: 'absolute', left: x - s / 2, top: y - s / 2, width: s, height: s, borderRadius: s / 2 }}
        onPress={onPress}
      />
    );
  };

  if (key === 'threads') return <>{layout.threads.items.map((it) => hit(`h-${it.id}`, it.x, it.y, it.r, () => cb.selectThread(it.d)))}</>;
  if (key === 'contradictions')
    return (
      <>
        {layout.contradictions.map((p) =>
          hit(`h-${p.id}`, (p.ax + p.bx) / 2, (p.ay + p.by) / 2, 40, () => cb.selectContradiction(p.d)),
        )}
      </>
    );
  if (key === 'convergence') return <>{layout.convergence.map((g) => hit(`h-${g.id}`, g.x, g.y, g.r, () => cb.selectConvergence(g.d)))}</>;
  if (key === 'dormant') return <>{layout.dormant.map((d) => hit(`h-${d.id}`, d.x, d.y, 26, () => cb.selectDormant(d.d)))}</>;
  if (key === 'evolution')
    return (
      <>
        {layout.evolution.tracks.flatMap((t) =>
          t.dots.map((dot, i) => hit(`h-${t.id}-${i}`, dot.x, t.y, Math.max(dot.r, 12), () => cb.selectEvolution(t.arc, dot.period))),
        )}
      </>
    );
  return null;
}

function PanelMeta({ left, right }: { left: string; right: string }) {
  return (
    <View style={styles.panelMeta}>
      <Text style={styles.panelMetaText}>{left}</Text>
      <Text style={styles.panelMetaText}>{right}</Text>
    </View>
  );
}

const PANEL_TEXT = 'rgba(236,236,236,0.92)';
const PANEL_MUTED = 'rgba(236,236,236,0.55)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MAP_BG },
  safe: { flex: 1 },
  header: {
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
  activeName: {
    paddingHorizontal: Spacing[6], color: 'rgba(236,236,236,0.4)',
    letterSpacing: 2, textTransform: 'uppercase',
  },

  legend: {
    position: 'absolute', bottom: Platform.OS === 'ios' ? 100 : 82,
    left: 0, right: 0, alignItems: 'center',
  },
  legendText: { color: 'rgba(236,236,236,0.4)', letterSpacing: 1 },

  scrubWrap: {
    position: 'absolute', bottom: Platform.OS === 'ios' ? 100 : 82,
    left: Spacing[6], alignItems: 'stretch',
  },
  scrubHint: { color: 'rgba(236,236,236,0.4)', marginBottom: Spacing[2], letterSpacing: 1 },
  scrubRail: { height: 24, justifyContent: 'center' },
  scrubTrack: { position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 1, backgroundColor: 'rgba(236,236,236,0.14)' },
  scrubFill: { position: 'absolute', left: 0, height: 2, borderRadius: 1, backgroundColor: 'rgba(126,200,160,0.7)' },
  scrubThumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: '#7EC8A0' },

  panel: {
    position: 'absolute', left: Spacing[4], right: Spacing[4],
    bottom: Platform.OS === 'ios' ? 96 : 78,
    backgroundColor: 'rgba(20,20,20,0.96)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16, padding: Spacing[4],
  },
  panelHandle: {
    alignSelf: 'center', width: 34, height: 3, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)', marginBottom: Spacing[3],
  },
  panelMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing[2] },
  panelMetaText: { fontFamily: FontFamily.mono, fontSize: 10, color: PANEL_MUTED, letterSpacing: 0.5 },
  panelBody: { fontFamily: FontFamily.sans, fontSize: 14, lineHeight: 20, color: PANEL_TEXT },
  panelSub: { fontFamily: FontFamily.mono, fontSize: 11, lineHeight: 17, color: PANEL_MUTED, marginTop: Spacing[3] },
  panelCta: { marginTop: Spacing[4], paddingTop: Spacing[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  panelCtaText: { fontFamily: FontFamily.mono, fontSize: 11, color: PANEL_MUTED },
  pairRow: { flexDirection: 'row', gap: Spacing[3], marginBottom: Spacing[2] },
  pairSide: { flex: 1 },
  pairTag: { fontFamily: FontFamily.mono, fontSize: 10, color: PANEL_MUTED, marginBottom: 4 },
  panelClose: { position: 'absolute', top: Spacing[3], right: Spacing[4] },
  panelCloseText: { fontFamily: FontFamily.mono, fontSize: 10, color: PANEL_MUTED },
});
