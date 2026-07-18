import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeftIcon } from 'lucide-react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { TemporalSpine } from '@/components/mind/TemporalSpine';
import { FractureZone } from '@/components/mind/FractureZone';
import { KeystoneBridge } from '@/components/mind/KeystoneBridge';
import {
  ConfluenceRow,
  EmberRow,
  FaultWall,
  SectionHeader,
  ThreadStrand,
} from '@/components/mind/overviewSections';
import { stageInk } from '@/components/mind/DetailShell';
import type {
  ContradictionCard,
  ConvergenceSignal,
  DormantThread,
  PersonalIntelligenceResponse,
  ThreadSynthesis,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────
// Mind is NOT a second Atlas. Atlas maps where your knowledge lives; Mind
// reports the forces moving through it. Opening the tab lands on a calm
// threshold — a slow-breathing mark and the list of instruments with
// something to say. Choosing one opens THAT instrument alone on its own
// screen (a proper ← returns); "see everything" browses the full dossier.
// Every surface sits on the same map background as Atlas.
// ─────────────────────────────────────────────────────────────────────────

const ACCENT = {
  threads: '#6E90AE',
  contradictions: '#B08276',
  convergence: '#8A7EA6',
  dormant: '#7C7C82',
} as const;

type SectionKey = keyof typeof ACCENT;
type ViewState = 'threshold' | 'all' | SectionKey;

const SECTION_META: { key: SectionKey; name: string; whisper: string }[] = [
  { key: 'threads', name: 'threads', whisper: 'where your thinking is heading' },
  { key: 'contradictions', name: 'contradictions', whisper: 'where it disagrees with itself' },
  { key: 'convergence', name: 'convergence', whisper: 'different roads, one arrival' },
  { key: 'dormant', name: 'dormant', whisper: 'gone quiet — worth reawakening?' },
];

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
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<ViewState>('threshold');

  const { data, loading, error, refetch } = useApiQuery(() => api.memory.intelligence(), [], { cacheKey: 'memory.intelligence' });
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const intel = data ?? EMPTY_INTEL;
  const counts: Record<SectionKey, number> = {
    threads: intel.threadSyntheses.length,
    contradictions: intel.contradictionCards.length,
    convergence: intel.convergenceSignals.length,
    dormant: intel.dormantThreads.length,
  };
  const activeSections = SECTION_META.filter((s) => counts[s.key] > 0);
  const hasContent = activeSections.length > 0;

  const openItem = useCallback((id: string) => {
    router.push(`/insight/${id}` as never);
  }, [router]);

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

  // Which selections open a dedicated full-screen visualization; the rest
  // (dormant, or data cached before the visualization fields existed) keep
  // the small explanation sheet.
  const immersive =
    selection?.type === 'contradiction' ||
    (selection?.type === 'thread' && (selection.d.timeline?.length ?? 0) >= 2) ||
    (selection?.type === 'convergence' && (selection.d.clusters?.length ?? 0) >= 2);

  const renderSection = (key: SectionKey) => {
    switch (key) {
      case 'threads':
        return intel.threadSyntheses.map((d) => (
          <ThreadStrand
            key={d.topicId}
            data={d}
            color={ACCENT.threads}
            onPress={() => setSelection({ type: 'thread', d })}
          />
        ));
      case 'contradictions':
        return (
          <FaultWall
            cards={intel.contradictionCards}
            color={ACCENT.contradictions}
            onOpen={(card) => setSelection({ type: 'contradiction', d: card })}
          />
        );
      case 'convergence':
        return intel.convergenceSignals.map((d) => (
          <ConfluenceRow
            key={d.topicId}
            data={d}
            color={ACCENT.convergence}
            onPress={() => setSelection({ type: 'convergence', d })}
          />
        ));
      case 'dormant':
        return intel.dormantThreads.map((d) => (
          <EmberRow
            key={d.topicId}
            data={d}
            color={ACCENT.dormant}
            onPress={() => setSelection({ type: 'dormant', d })}
          />
        ));
    }
  };

  // ── Loading / error / empty — all on the Atlas map background ───────────
  if (loading && !data) {
    return (
      <View style={[styles.root, { backgroundColor: c.mapBackground }]}>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.headerRow}>
            <Text variant="wordmark" style={{ color: stageInk(0.92) }}>mind</Text>
          </View>
          <AsciiLoader
            fill
            size={96}
            color={stageInk(0.8)}
            message={['sifting your mind…', 'weighing tensions…', 'connecting the dots…']}
          />
        </SafeAreaView>
      </View>
    );
  }
  if (error && !data) {
    return (
      <View style={[styles.root, { backgroundColor: c.mapBackground }]}>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.headerRow}>
            <Text variant="wordmark" style={{ color: stageInk(0.92) }}>mind</Text>
          </View>
          <View style={styles.stateBlock}>
            <Text variant="serif" style={{ color: stageInk(0.92), textAlign: 'center' }}>Mind unavailable</Text>
            <Text variant="monoSmall" style={styles.stateBody}>{error}</Text>
            <Pressable onPress={() => void refetch()} style={{ marginTop: Spacing[5], alignSelf: 'center' }}>
              <Text variant="monoSmall" style={{ color: stageInk(0.85) }}>retry</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }
  if (!hasContent) {
    return (
      <View style={[styles.root, { backgroundColor: c.mapBackground }]}>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <View style={styles.headerRow}>
            <Text variant="wordmark" style={{ color: stageInk(0.92) }}>mind</Text>
          </View>
          <View style={styles.stateBlock}>
            <BreathingMark color={stageInk(0.5)} />
            <Text variant="serif" style={{ color: stageInk(0.92), textAlign: 'center', marginTop: Spacing[5] }}>
              Your mind is quiet for now
            </Text>
            <Text variant="monoSmall" style={styles.stateBody}>
              Save a few more things and instruments surface here on their own: threads you're chasing, ideas in tension, topics converging or going dormant.
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const pulse = activeSections
    .map((s) => `${counts[s.key]} ${counts[s.key] === 1 ? s.name.replace(/s$/, '') : s.name}`)
    .join(' · ');

  const currentMeta = view !== 'threshold' && view !== 'all'
    ? SECTION_META.find((s) => s.key === view)
    : null;

  return (
    <View style={[styles.root, { backgroundColor: c.mapBackground }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        {view === 'threshold' ? (
          <>
            <View style={styles.headerRow}>
              <Text variant="wordmark" style={{ color: stageInk(0.92) }}>mind</Text>
              <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About mind">
                <Text style={{ color: stageInk(0.5), fontSize: 16 }}>ⓘ</Text>
              </Pressable>
            </View>
            <Animated.View
              key="threshold"
              entering={FadeIn.duration(300)}
              exiting={FadeOut.duration(200)}
              style={styles.threshold}
            >
              <BreathingMark color={stageInk(0.55)} />
              <Text variant="serif" style={styles.thresholdTitle}>
                A read of what your mind has been up to
              </Text>
              <Text variant="monoSmall" style={styles.thresholdPulse}>{pulse}</Text>

              <View style={styles.thresholdList}>
                {activeSections.map((s) => (
                  <Pressable
                    key={s.key}
                    onPress={() => setView(s.key)}
                    style={styles.thresholdRow}
                    accessibilityLabel={`Open ${s.name}`}
                  >
                    <View style={[styles.thresholdTick, { backgroundColor: ACCENT[s.key] }]} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" style={{ color: stageInk(0.9) }}>{s.name}</Text>
                      <Text variant="monoSmall" style={{ color: stageInk(0.4), marginTop: 1 }}>{s.whisper}</Text>
                    </View>
                    <Text variant="monoSmall" style={{ color: ACCENT[s.key] }}>{counts[s.key]}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={() => setView('all')} style={styles.seeAll} accessibilityLabel="See everything">
                <Text variant="monoSmall" style={{ color: stageInk(0.5), letterSpacing: 1 }}>see everything ↓</Text>
              </Pressable>
            </Animated.View>
          </>
        ) : (
          <Animated.View key={view} entering={FadeIn.duration(280)} style={styles.safe}>
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => setView('threshold')}
                hitSlop={12}
                style={styles.backBtn}
                accessibilityLabel="Back to Mind overview"
              >
                <ChevronLeftIcon size={22} color={stageInk(0.9)} />
              </Pressable>
              <Text variant="monoSmall" style={{ color: stageInk(0.55), letterSpacing: 2 }}>
                {view === 'all' ? 'everything' : currentMeta?.name}
              </Text>
              <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About mind">
                <Text style={{ color: stageInk(0.5), fontSize: 16 }}>ⓘ</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              {view === 'all' ? (
                activeSections.map((s) => (
                  <View key={s.key}>
                    <SectionHeader title={s.name.toUpperCase()} whisper={s.whisper} color={ACCENT[s.key]} />
                    {renderSection(s.key)}
                  </View>
                ))
              ) : (
                <>
                  <Text variant="monoSmall" style={styles.sectionWhisper}>
                    {currentMeta?.whisper}
                  </Text>
                  {renderSection(view)}
                </>
              )}
            </ScrollView>
          </Animated.View>
        )}
      </SafeAreaView>

      {/* ── Immersive detail views ──────────────────────────────────────── */}
      {selection?.type === 'thread' && (selection.d.timeline?.length ?? 0) >= 2 && (
        <TemporalSpine
          data={selection.d}
          color={ACCENT.threads}
          background={c.mapBackground}
          onClose={() => setSelection(null)}
          onOpenItem={openItem}
          onContinueCompanion={() => continueInCompanion(selection.d)}
          onViewAtlas={() => viewInAtlas(selection.d)}
        />
      )}
      {selection?.type === 'contradiction' && (
        <FractureZone
          data={selection.d}
          color={ACCENT.contradictions}
          background={c.mapBackground}
          onClose={() => setSelection(null)}
          onOpenItem={openItem}
        />
      )}
      {selection?.type === 'convergence' && (selection.d.clusters?.length ?? 0) >= 2 && (
        <KeystoneBridge
          data={selection.d}
          color={ACCENT.convergence}
          background={c.mapBackground}
          onClose={() => setSelection(null)}
          onOpenItem={openItem}
        />
      )}

      {/* ── Small sheet (dormant + pre-visualization fallbacks) ─────────── */}
      {selection && !immersive && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: c.border }]} />
          <View style={styles.sheetHead}>
            <View style={styles.sheetHeadLeft}>
              <View style={[styles.sheetDot, { backgroundColor: ACCENT[selection.type === 'thread' ? 'threads' : selection.type === 'convergence' ? 'convergence' : 'dormant'] }]} />
              <Text variant="monoSmall" style={{ letterSpacing: 2 }} color="muted">
                {selection.type.toUpperCase()}
              </Text>
            </View>
            <Pressable onPress={() => setSelection(null)} hitSlop={12}>
              <Text variant="monoSmall" color="faint">close</Text>
            </Pressable>
          </View>
          {selection.type === 'dormant' ? (
            <>
              <View style={styles.sheetMeta}>
                <Text variant="monoSmall" color="muted">{selection.d.topicName}</Text>
                <Text variant="monoSmall" color="muted">{selection.d.captureCount} captures</Text>
              </View>
              <Text variant="body" numberOfLines={3} style={{ marginTop: Spacing[3] }}>
                Quiet for {selection.d.daysSilent} days. You went deep here once — worth reawakening?
              </Text>
            </>
          ) : selection.type === 'thread' ? (
            <Text variant="body" numberOfLines={5} style={{ marginTop: Spacing[2] }}>
              {selection.d.position}
            </Text>
          ) : selection.type === 'convergence' ? (
            <Text variant="body" numberOfLines={5} style={{ marginTop: Spacing[2] }}>
              {selection.d.signal}
            </Text>
          ) : null}
        </Animated.View>
      )}

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="mind"
        body="A report of the forces in your thinking, not a map. Strands show where threads are heading; the fault wall shows where your saved ideas collide; streams show different sources arriving at one idea; embers show what's gone quiet. Tap any instrument to go inside it."
      />
    </View>
  );
}

/** A slow-breathing mark — the calm center of the threshold. */
function BreathingMark({ color }: { color: string }) {
  const breath = useSharedValue(0);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [breath]);
  const outer = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.14 }],
    opacity: 0.35 + breath.value * 0.25,
  }));
  const inner = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.06 }],
  }));
  return (
    <View style={bm.wrap}>
      <Animated.View style={[bm.outer, { borderColor: color }, outer]} />
      <Animated.View style={[bm.inner, { backgroundColor: color }, inner]} />
    </View>
  );
}

const bm = StyleSheet.create({
  wrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  outer: { position: 'absolute', width: 56, height: 56, borderRadius: 28, borderWidth: 1 },
  inner: { width: 10, height: 10, borderRadius: 5 },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingTop: Spacing[3], paddingBottom: Spacing[2],
  },
  backBtn: { padding: Spacing[1], marginLeft: -Spacing[2] },

  stateBlock: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing[8], paddingBottom: Spacing[16] },
  stateBody: {
    color: 'rgba(236,236,236,0.45)',
    textAlign: 'center',
    marginTop: Spacing[3],
    lineHeight: 20,
  },

  threshold: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing[8], paddingBottom: Spacing[12] },
  thresholdTitle: { color: 'rgba(236,236,236,0.92)', textAlign: 'center', marginTop: Spacing[5] },
  thresholdPulse: {
    color: 'rgba(236,236,236,0.38)', textAlign: 'center',
    marginTop: Spacing[2], letterSpacing: 1,
  },
  thresholdList: { marginTop: Spacing[10], gap: Spacing[2] },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[3],
    gap: Spacing[4],
  },
  thresholdTick: { width: 8, height: 22, borderRadius: 2 },
  seeAll: { alignSelf: 'center', marginTop: Spacing[10], padding: Spacing[2] },

  sectionWhisper: {
    color: 'rgba(236,236,236,0.4)',
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[2],
    marginBottom: Spacing[5],
  },
  scroll: { paddingBottom: Platform.OS === 'ios' ? 110 : 92 },

  sheet: {
    position: 'absolute', left: Spacing[4], right: Spacing[4],
    bottom: Platform.OS === 'ios' ? 96 : 78,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: Spacing[4],
  },
  sheetHandle: { alignSelf: 'center', width: 34, height: 3, borderRadius: 2, marginBottom: Spacing[3] },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing[2] },
  sheetHeadLeft: { flexDirection: 'row', alignItems: 'center' },
  sheetDot: { width: 7, height: 7, borderRadius: 4, marginRight: Spacing[2] },
  sheetMeta: { flexDirection: 'row', justifyContent: 'space-between' },
});
