import React, { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { InfoModal } from '@/components/ui/InfoModal';
import { ScreenIntro } from '@/components/ui/ScreenIntro';
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
// reports the forces moving through it. It reads as a vertical dossier of
// instruments, each shaped like the thing it measures: strands for threads,
// a fault-crack for contradictions, merging streams for convergence, embers
// for what's gone quiet. Tapping an instrument opens its immersive view.
// Sections only render when they have something to say; a fifth instrument
// can join the stack without any structural change.
// ─────────────────────────────────────────────────────────────────────────

// Deliberately desaturated accents (Atlas convention: the stage is dark).
const ACCENT = {
  threads: '#6E90AE',
  contradictions: '#B08276',
  convergence: '#8A7EA6',
  dormant: '#7C7C82',
} as const;

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

  const { data, loading, error, refetch } = useApiQuery(() => api.memory.intelligence(), [], { cacheKey: 'memory.intelligence' });
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const intel = data ?? EMPTY_INTEL;
  const hasContent =
    intel.threadSyntheses.length > 0 ||
    intel.contradictionCards.length > 0 ||
    intel.convergenceSignals.length > 0 ||
    intel.dormantThreads.length > 0;

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
          body="Save a few more things and instruments surface here on their own: threads you're chasing, ideas in tension, topics converging or going dormant."
        />
      </SafeAreaView>
    );
  }

  const pulse = [
    intel.threadSyntheses.length > 0 && `${intel.threadSyntheses.length} ${intel.threadSyntheses.length === 1 ? 'thread' : 'threads'}`,
    intel.contradictionCards.length > 0 && `${intel.contradictionCards.length} ${intel.contradictionCards.length === 1 ? 'tension' : 'tensions'}`,
    intel.convergenceSignals.length > 0 && `${intel.convergenceSignals.length} ${intel.convergenceSignals.length === 1 ? 'convergence' : 'convergences'}`,
    intel.dormantThreads.length > 0 && `${intel.dormantThreads.length} dormant`,
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.root, { backgroundColor: c.mapBackground }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.headerRow}>
          <Text variant="wordmark" style={{ color: stageInk(0.92) }}>mind</Text>
          <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About mind">
            <Text style={{ color: stageInk(0.5), fontSize: 16 }}>ⓘ</Text>
          </Pressable>
        </View>
        <Text variant="monoSmall" style={styles.pulse}>{pulse}</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {intel.threadSyntheses.length > 0 && (
            <>
              <SectionHeader
                title="THREADS"
                whisper="where your thinking is heading"
                count={`${intel.threadSyntheses.length}`}
                color={ACCENT.threads}
              />
              {intel.threadSyntheses.map((d) => (
                <ThreadStrand
                  key={d.topicId}
                  data={d}
                  color={ACCENT.threads}
                  onPress={() => setSelection({ type: 'thread', d })}
                />
              ))}
            </>
          )}

          {intel.contradictionCards.length > 0 && (
            <>
              <SectionHeader
                title="CONTRADICTIONS"
                whisper="where it disagrees with itself"
                count={`${intel.contradictionCards.length}`}
                color={ACCENT.contradictions}
              />
              <FaultWall
                cards={intel.contradictionCards}
                color={ACCENT.contradictions}
                onOpen={(card) => setSelection({ type: 'contradiction', d: card })}
              />
            </>
          )}

          {intel.convergenceSignals.length > 0 && (
            <>
              <SectionHeader
                title="CONVERGENCE"
                whisper="different roads, one arrival"
                count={`${intel.convergenceSignals.length}`}
                color={ACCENT.convergence}
              />
              {intel.convergenceSignals.map((d) => (
                <ConfluenceRow
                  key={d.topicId}
                  data={d}
                  color={ACCENT.convergence}
                  onPress={() => setSelection({ type: 'convergence', d })}
                />
              ))}
            </>
          )}

          {intel.dormantThreads.length > 0 && (
            <>
              <SectionHeader
                title="DORMANT"
                whisper="gone quiet — worth reawakening?"
                count={`${intel.dormantThreads.length}`}
                color={ACCENT.dormant}
              />
              {intel.dormantThreads.map((d) => (
                <EmberRow
                  key={d.topicId}
                  data={d}
                  color={ACCENT.dormant}
                  onPress={() => setSelection({ type: 'dormant', d })}
                />
              ))}
            </>
          )}
        </ScrollView>
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
        <View style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }]}>
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
        </View>
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  headerFlat: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[4], borderBottomWidth: 1,
  },
  retry: { alignSelf: 'center', marginTop: Spacing[4] },

  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingTop: Spacing[3],
  },
  pulse: { paddingHorizontal: Spacing[6], marginTop: 2, color: 'rgba(236,236,236,0.38)', letterSpacing: 1 },
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
