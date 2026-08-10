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
import { useTheme, useThemeColors } from '@/contexts/ThemeContext';
import { darkenHex } from '@/lib/atlasShare';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
import { SponsoredCard } from '@/components/ui/SponsoredCard';
import { TemporalSpine } from '@/components/mind/TemporalSpine';
import { FractureZone } from '@/components/mind/FractureZone';
import { KeystoneBridge } from '@/components/mind/KeystoneBridge';
import { BankedEmber } from '@/components/mind/BankedEmber';
import {
  ConfluenceRow,
  EmberRow,
  FaultWall,
  SectionHeader,
  ThreadStrand,
} from '@/components/mind/overviewSections';
import { useStageInk } from '@/components/mind/DetailShell';
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
// Every surface sits on the app theme background, like the list tabs — only
// the Atlas keeps the always-dark map surface.
// ─────────────────────────────────────────────────────────────────────────

// One hue per instrument, cut like the Atlas cluster palette: enough chroma to
// name the instrument at a glance, held mid-luminance. That tuning is for a
// dark ground — on paper the same hues wash out, so light mode pulls each one
// toward ink (same move the share card makes for its field names).
const ACCENT_BASE = {
  threads: '#6E9AD1',
  contradictions: '#C4877A',
  convergence: '#9885C9',
  dormant: '#8A8A93',
} as const;

type SectionKey = keyof typeof ACCENT_BASE;

function useMindAccents(): Record<SectionKey, string> {
  const { scheme } = useTheme();
  return React.useMemo(() => {
    if (scheme === 'dark') return ACCENT_BASE;
    return {
      threads: darkenHex(ACCENT_BASE.threads, 0.32),
      contradictions: darkenHex(ACCENT_BASE.contradictions, 0.32),
      convergence: darkenHex(ACCENT_BASE.convergence, 0.32),
      dormant: darkenHex(ACCENT_BASE.dormant, 0.32),
    };
  }, [scheme]);
}

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

/**
 * Mind's stage, cut exactly like the other list tabs (archive/pulse/you): a
 * dark chrome band wearing the wordmark, with the page on `canvas` below it.
 * Every state — loading, error, empty, threshold, dossier — renders through
 * this wrapper, which is what keeps the tab reading as a sibling of the other
 * three as states get added. Overlays (detail views, sheets) mount above the
 * whole stage, header included, exactly as they did before.
 */
function MindStage({
  header,
  overlay,
  children,
}: {
  header: React.ReactNode;
  overlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.root, { backgroundColor: c.canvas }]}>
      {/* The safe-area strip takes `deep` too, so the notch region reads as
          part of the header rather than as a pale sliver over it. */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.deep }}>
        <View style={[styles.headerRow, { borderBottomColor: c.deepBorder }]}>{header}</View>
      </SafeAreaView>
      <View style={styles.body}>{children}</View>
      {overlay}
    </View>
  );
}

export default function MindScreen() {
  const c = useThemeColors();
  const ink = useStageInk();
  const ACCENT = useMindAccents();
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
    router.push(`/insight/${id}?from=mind` as never);
  }, [router]);

  const continueInCompanion = useCallback((itemIds: string[], contextLabel: string, prefill: string) => {
    router.push({
      pathname: '/companion',
      params: {
        contextIds: itemIds.join(','),
        contextLabels: contextLabel,
        prefill,
      },
    } as never);
  }, [router]);

  const viewInAtlas = useCallback((itemIds: string[]) => {
    router.navigate({ pathname: '/(tabs)', params: { selectIds: itemIds.join(',') } } as never);
  }, [router]);

  const contradictionItemIds = useCallback(
    (d: ContradictionCard) => [
      d.itemAId,
      d.itemBId,
      ...(d.sideA ?? []).map((n) => n.id),
      ...(d.sideB ?? []).map((n) => n.id),
    ],
    [],
  );

  const convergenceItemIds = useCallback(
    (d: ConvergenceSignal) => (d.clusters ?? []).flatMap((c) => c.items.map((n) => n.id)),
    [],
  );

  // Which selections open a dedicated full-screen visualization; only data
  // cached before the visualization fields existed still falls back to the
  // small explanation sheet.
  const immersive =
    selection?.type === 'contradiction' ||
    selection?.type === 'dormant' ||
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

  const wordmark = <Text variant="wordmark" style={{ color: c.deepInk }}>mind</Text>;

  // ── Loading / error / empty ──────────────────────────────────────────────
  if (loading && !data) {
    // No loader animation on an unpopulated screen — the page simply arrives.
    return <MindStage header={wordmark}>{null}</MindStage>;
  }
  if (error && !data) {
    return (
      <MindStage header={wordmark}>
        <View style={styles.stateBlock}>
          <Text variant="serif" style={{ color: ink(0.92), textAlign: 'center' }}>Mind unavailable</Text>
          <Text variant="monoSmall" style={[styles.stateBody, { color: ink(0.57) }]}>{error}</Text>
          <Pressable onPress={() => void refetch()} style={{ marginTop: Spacing[5], alignSelf: 'center' }}>
            <Text variant="monoSmall" style={{ color: ink(0.85) }}>retry</Text>
          </Pressable>
        </View>
      </MindStage>
    );
  }
  if (!hasContent) {
    return (
      <MindStage header={wordmark}>
        <ScreenIntro
          art="brain"
          title="Patterns from your saves"
          body="Mind reads everything you save and reports what it finds: threads you keep pulling, ideas that clash, topics going quiet. Save 2 or 3 related things and the first patterns appear here."
          actions={[
            { label: 'start on atlas →', onPress: () => router.push('/(tabs)' as never) },
          ]}
        />
      </MindStage>
    );
  }

  const currentMeta = view !== 'threshold' && view !== 'all'
    ? SECTION_META.find((s) => s.key === view)
    : null;

  const infoButton = (
    <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About mind">
      <Text style={{ color: c.deepInkFaint, fontSize: 16 }}>ⓘ</Text>
    </Pressable>
  );
  const header = view === 'threshold' ? (
    <>
      {wordmark}
      {infoButton}
    </>
  ) : (
    <>
      <Pressable
        onPress={() => setView('threshold')}
        hitSlop={12}
        style={styles.backBtn}
        accessibilityLabel="Back to Mind overview"
      >
        <ChevronLeftIcon size={22} color={c.deepInk} />
      </Pressable>
      <Text variant="monoSmall" style={{ color: c.deepInkMuted, letterSpacing: 2 }}>
        {view === 'all' ? 'everything' : currentMeta?.name}
      </Text>
      {infoButton}
    </>
  );

  return (
    <MindStage
      header={header}
      overlay={
        <>
          {/* ── Immersive detail views ──────────────────────────────────── */}
          {selection?.type === 'thread' && (selection.d.timeline?.length ?? 0) >= 2 && (
            <TemporalSpine
              data={selection.d}
              color={ACCENT.threads}
              background={c.canvas}
              onClose={() => setSelection(null)}
              onOpenItem={openItem}
              onContinueCompanion={() => continueInCompanion(
                selection.d.itemIds,
                selection.d.topicName,
                `Here's where I seem to have landed on ${selection.d.topicName}: "${selection.d.position}"\n\n` +
                  `The open question: ${selection.d.openQuestion}\n\n` +
                  `My take: `,
              )}
              onViewAtlas={() => viewInAtlas(selection.d.itemIds)}
            />
          )}
          {selection?.type === 'contradiction' && (
            <FractureZone
              data={selection.d}
              color={ACCENT.contradictions}
              background={c.canvas}
              onClose={() => setSelection(null)}
              onOpenItem={openItem}
              onContinueCompanion={() => continueInCompanion(
                contradictionItemIds(selection.d),
                `${selection.d.labelA} vs ${selection.d.labelB}`,
                `Here's a tension I've been sitting with: "${selection.d.labelA}" versus "${selection.d.labelB}".\n\n` +
                  (selection.d.crux ? `The crux: ${selection.d.crux}\n\n` : '') +
                  `My take: `,
              )}
              onViewAtlas={() => viewInAtlas(contradictionItemIds(selection.d))}
            />
          )}
          {selection?.type === 'convergence' && (selection.d.clusters?.length ?? 0) >= 2 && (
            <KeystoneBridge
              data={selection.d}
              color={ACCENT.convergence}
              background={c.canvas}
              onClose={() => setSelection(null)}
              onOpenItem={openItem}
              onContinueCompanion={() => continueInCompanion(
                convergenceItemIds(selection.d),
                selection.d.topicName,
                `Here's where different sources seem to be converging on ${selection.d.topicName}` +
                  (selection.d.arrival ? `: "${selection.d.arrival}"` : '') + `.\n\n` +
                  `My take: `,
              )}
              onViewAtlas={() => viewInAtlas(convergenceItemIds(selection.d))}
            />
          )}
          {selection?.type === 'dormant' && (
            <BankedEmber
              data={selection.d}
              color={ACCENT.dormant}
              background={c.canvas}
              onClose={() => setSelection(null)}
              onContinueCompanion={() => continueInCompanion(
                [],
                selection.d.topicName,
                `I went deep on ${selection.d.topicName} once — ${selection.d.captureCount} captures — ` +
                  `and then it went quiet for ${selection.d.daysSilent} days.\n\n` +
                  `What did I leave unfinished there?`,
              )}
              onOpenFolder={() => router.push(`/archive/${selection.d.topicId}` as never)}
            />
          )}

          {/* ── Small sheet (pre-visualization fallbacks) ───────────────── */}
          {selection && !immersive && (
            <Animated.View
              entering={FadeIn.duration(200)}
              style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: c.border }]} />
              <View style={styles.sheetHead}>
                <View style={styles.sheetHeadLeft}>
                  <View style={[styles.sheetDot, { backgroundColor: ACCENT[selection.type === 'convergence' ? 'convergence' : 'threads'] }]} />
                  <Text variant="monoSmall" style={{ letterSpacing: 2 }} color="muted">
                    {selection.type.toUpperCase()}
                  </Text>
                </View>
                <Pressable onPress={() => setSelection(null)} hitSlop={12}>
                  <Text variant="monoSmall" color="faint">close</Text>
                </Pressable>
              </View>
              {selection.type === 'thread' ? (
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
        </>
      }
    >
      {view === 'threshold' ? (
        <Animated.View
          key="threshold"
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          style={styles.threshold}
        >
          <BreathingMark color={ink(0.55)} />
          <Text variant="serif" style={[styles.thresholdTitle, { color: ink(0.94) }]}>
            A read of what your mind has been up to
          </Text>
          {/* No summary line here. It restated "3 threads · 2 dormant"
              immediately above a list that names each instrument and prints
              its own count on the right — the same numbers twice. */}
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
                  <Text variant="bodyMedium" style={{ color: ink(0.9) }}>{s.name}</Text>
                  <Text variant="monoSmall" style={{ color: ink(0.4), marginTop: 1 }}>{s.whisper}</Text>
                </View>
                <Text variant="monoSmall" style={{ color: ACCENT[s.key] }}>{counts[s.key]}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={() => setView('all')} style={styles.seeAll} accessibilityLabel="See everything">
            <Text variant="monoSmall" style={{ color: ink(0.5), letterSpacing: 1 }}>see everything ↓</Text>
          </Pressable>
        </Animated.View>
      ) : (
        <Animated.View key={view} entering={FadeIn.duration(280)} style={styles.safe}>
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
                {view === 'dormant' ? (
                  <Text variant="monoSmall" style={[styles.sectionWhisper, { color: ink(0.53) }]}>
                    {currentMeta?.whisper}
                  </Text>
                ) : null}
                {renderSection(view)}
              </>
            )}

            {/* Past the end of the instrument, so it never sits between two
                readings. Auto tone: Mind's stage follows the app theme. */}
            <SponsoredCard />
          </ScrollView>
        </Animated.View>
      )}
    </MindStage>
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
  // The chrome band, in step with archive/pulse/you.
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1 },
  backBtn: { padding: Spacing[1], marginLeft: -Spacing[2] },

  stateBlock: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing[8], paddingBottom: Spacing[16] },
  stateBody: {
    textAlign: 'center',
    marginTop: Spacing[3],
    lineHeight: 20,
  },

  threshold: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing[8], paddingBottom: Spacing[12] },
  thresholdTitle: { textAlign: 'center', marginTop: Spacing[5] },
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
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[2],
    marginBottom: Spacing[5],
  },
  scroll: { paddingBottom: Platform.OS === 'ios' ? 98 : 82 },

  sheet: {
    position: 'absolute', left: Spacing[4], right: Spacing[4],
    bottom: Platform.OS === 'ios' ? 84 : 68,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: Spacing[4],
  },
  sheetHandle: { alignSelf: 'center', width: 34, height: 3, borderRadius: 2, marginBottom: Spacing[3] },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing[2] },
  sheetHeadLeft: { flexDirection: 'row', alignItems: 'center' },
  sheetDot: { width: 7, height: 7, borderRadius: 4, marginRight: Spacing[2] },
});
