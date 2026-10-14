import React, { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, XIcon } from 'lucide-react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { useTheme, useThemeColors } from '@/contexts/ThemeContext';
import { darkenHex } from '@/lib/atlasShare';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
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
import { FadeInView, useStageInk } from '@/components/mind/DetailShell';
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
// threshold: the list of instruments with something to say. Choosing one
// opens THAT instrument alone on its own screen (a proper back chevron
// returns); "See all" browses the full dossier.
// Every surface sits on the app theme background, like the list tabs; only
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

const SECTION_META: { key: SectionKey; name: string; subtitle: string }[] = [
  { key: 'threads', name: 'Threads', subtitle: 'Where your thinking is heading' },
  { key: 'contradictions', name: 'Contradictions', subtitle: 'Where your saves disagree' },
  { key: 'convergence', name: 'Convergence', subtitle: 'Different sources reaching one idea' },
  { key: 'dormant', name: 'Quiet topics', subtitle: "Topics you haven't added to in a while" },
];

const MARK = 36;

/**
 * Each section's mark is a miniature of its own instrument, drawn in its
 * colour: the strand with beads and an arrowhead (Threads), two masses
 * across a rift (Contradictions), streams meeting at a point (Convergence),
 * an ember with its rings of heat (Quiet topics). Not a stock glyph: the
 * row shows the thing the screen behind it draws large.
 */
function SectionMark({ section, color }: { section: SectionKey; color: string }) {
  switch (section) {
    case 'threads':
      return (
        <Svg width={MARK} height={MARK} viewBox="0 0 36 36" pointerEvents="none">
          <Path d="M3,20 C9,12 14,26 20,18 S28,13 31,17" fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.5} />
          <Circle cx={6} cy={17} r={2} fill={color} fillOpacity={0.55} />
          <Circle cx={17} cy={21} r={2.6} fill={color} fillOpacity={0.7} />
          <Circle cx={27} cy={15.5} r={3.4} fill={color} />
          <Path d="M30,13 L34,17 L30,21" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
        </Svg>
      );
    case 'contradictions':
      return (
        <Svg width={MARK} height={MARK} viewBox="0 0 36 36" pointerEvents="none">
          <Path d="M19,2 L15,10 L20,17 L15,25 L19,34" fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={5} />
          <Path d="M19,2 L15,10 L20,17 L15,25 L19,34" fill="none" stroke={color} strokeWidth={1.4} />
          <Circle cx={8} cy={13} r={5.5} fill={color} fillOpacity={0.9} />
          <Circle cx={28} cy={23} r={5.5} fill={color} fillOpacity={0.9} />
        </Svg>
      );
    case 'convergence':
      return (
        <Svg width={MARK} height={MARK} viewBox="0 0 36 36" pointerEvents="none">
          <Path d="M4,8 C16,8 18,18 28,18" fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={1.4} />
          <Path d="M4,28 C16,28 18,18 28,18" fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={1.4} />
          <Circle cx={4} cy={8} r={2.4} fill={color} fillOpacity={0.6} />
          <Circle cx={4} cy={28} r={2.4} fill={color} fillOpacity={0.6} />
          <Circle cx={28} cy={18} r={8} fill={color} fillOpacity={0.14} />
          <Circle cx={28} cy={18} r={4} fill={color} />
        </Svg>
      );
    case 'dormant':
      return (
        <Svg width={MARK} height={MARK} viewBox="0 0 36 36" pointerEvents="none">
          <Circle cx={18} cy={18} r={15} fill={color} fillOpacity={0.08} />
          <Circle cx={18} cy={18} r={10} fill={color} fillOpacity={0.16} />
          <Circle cx={18} cy={18} r={5} fill={color} fillOpacity={0.8} />
          <Circle cx={18} cy={18} r={2} fill={color} />
        </Svg>
      );
  }
}

type Selection =
  | { type: 'thread'; d: ThreadSynthesis }
  | { type: 'contradiction'; d: ContradictionCard }
  | { type: 'convergence'; d: ConvergenceSignal }
  | { type: 'dormant'; d: DormantThread }
  | null;

const SHEET_LABEL: Record<NonNullable<Selection>['type'], string> = {
  thread: 'Thread',
  contradiction: 'Contradiction',
  convergence: 'Convergence',
  dormant: 'Quiet topic',
};

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

  const wordmark = <Text variant="pageTitle" style={{ color: c.deepInk }}>Mind</Text>;

  // ── Loading / error / empty ──────────────────────────────────────────────
  if (loading && !data) {
    // No loader animation on an unpopulated screen; the page simply arrives.
    return <MindStage header={wordmark}>{null}</MindStage>;
  }
  if (error && !data) {
    return (
      <MindStage header={wordmark}>
        <View style={styles.stateBlock}>
          <Text variant="headline" style={{ color: ink(0.92), textAlign: 'center' }}>Mind unavailable</Text>
          <Text variant="caption" style={[styles.stateBody, { color: ink(0.57) }]}>{error}</Text>
          <Button
            label="Try again"
            variant="secondary"
            size="sm"
            onPress={() => void refetch()}
            style={{ marginTop: Spacing[5], alignSelf: 'center' }}
          />
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
          body="Mind looks for patterns across your saves: recurring threads, ideas that disagree, and topics going quiet. Save two or three related things and the first patterns appear here."
          actions={[
            { label: 'Open Atlas', onPress: () => router.push('/(tabs)' as never) },
          ]}
        />
      </MindStage>
    );
  }

  const currentMeta = view !== 'threshold' && view !== 'all'
    ? SECTION_META.find((s) => s.key === view)
    : null;

  const infoButton = (
    <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About Mind">
      <InfoIcon size={20} color={c.deepInkMuted} />
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
        hitSlop={16}
        style={styles.backBtn}
        accessibilityLabel="Back to Mind overview"
        accessibilityRole="button"
      >
        <ChevronLeftIcon size={22} color={c.deepInk} />
      </Pressable>
      <Text variant="headline" style={{ color: c.deepInk }}>
        {view === 'all' ? 'Everything' : currentMeta?.name}
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
                `I went deep on ${selection.d.topicName} once, ${selection.d.captureCount} captures, ` +
                  `and then it went quiet for ${selection.d.daysSilent} days.\n\n` +
                  `What did I leave unfinished there?`,
              )}
              onOpenFolder={() => router.push(`/archive/${selection.d.topicId}` as never)}
            />
          )}

          {/* ── Small sheet (pre-visualization fallbacks) ───────────────── */}
          {selection && !immersive && (
            <FadeInView
              duration={200}
              style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <View style={[styles.sheetHandle, { backgroundColor: c.border }]} />
              <View style={styles.sheetHead}>
                <Text variant="headline">
                  {SHEET_LABEL[selection.type]}
                </Text>
                <Pressable onPress={() => setSelection(null)} hitSlop={12} accessibilityLabel="Close">
                  <XIcon size={20} color={c.muted} />
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
            </FadeInView>
          )}

          <InfoModal
            visible={infoVisible}
            onClose={() => setInfoVisible(false)}
            title="About Mind"
            body="Mind reads what you save and reports the patterns in it. Threads show where your thinking is heading. Contradictions show where your saves disagree. Convergence shows different sources reaching one idea. Quiet topics are the ones you haven't added to in a while. Tap any section to open it."
          />
        </>
      }
    >
      {view === 'threshold' ? (
        <FadeInView key="threshold" duration={300} style={styles.threshold}>
          {/* An inset grouped list: the section's own mark in its colour,
              name and one-line description, the count as a trailing value, a
              chevron. The mark is a miniature of the screen behind the row. */}
          <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
            {activeSections.map((s, i) => (
              <Pressable
                key={s.key}
                onPress={() => setView(s.key)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.elevated }]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.name}`}
              >
                <View style={[styles.rowInner, i < activeSections.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderSubtle }]}>
                  <SectionMark section={s.key} color={ACCENT[s.key]} />
                  <View style={styles.rowText}>
                    <Text variant="headline" style={{ color: ink(0.9) }}>{s.name}</Text>
                    <Text variant="subheadline" color="secondary" style={{ marginTop: 1 }}>{s.subtitle}</Text>
                  </View>
                  <Text variant="body" color="muted">{counts[s.key]}</Text>
                  <ChevronRightIcon size={18} color={c.faint} />
                </View>
              </Pressable>
            ))}
          </View>

          <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.borderSubtle }]}>
            <Pressable
              onPress={() => setView('all')}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.elevated }]}
              accessibilityRole="button"
              accessibilityLabel="See all"
            >
              <View style={styles.rowInner}>
                <Text variant="body" style={[styles.rowText, { color: ink(0.9) }]}>See all</Text>
                <ChevronRightIcon size={18} color={c.faint} />
              </View>
            </Pressable>
          </View>
        </FadeInView>
      ) : (
        <FadeInView key={view} duration={280} style={styles.safe}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {view === 'all' ? (
              activeSections.map((s) => (
                <View key={s.key}>
                  <SectionHeader title={s.name} subtitle={s.subtitle} />
                  {renderSection(s.key)}
                </View>
              ))
            ) : (
              <>
                {view === 'dormant' ? (
                  <Text variant="subheadline" color="secondary" style={styles.sectionSubtitle}>
                    {currentMeta?.subtitle}
                  </Text>
                ) : null}
                {renderSection(view)}
              </>
            )}

            {/* Past the end of the instrument, so it never sits between two
                readings. Auto tone: Mind's stage follows the app theme. */}
            <SponsoredCard />
          </ScrollView>
        </FadeInView>
      )}
    </MindStage>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  // The chrome band, in step with archive/pulse/you.
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  body: { flex: 1 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -Spacing[3] },

  stateBlock: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing[8], paddingBottom: Spacing[16] },
  stateBody: {
    textAlign: 'center',
    marginTop: Spacing[3],
    lineHeight: 20,
  },

  threshold: { flex: 1, paddingHorizontal: Spacing[4], paddingTop: Spacing[5], gap: Spacing[5] },
  group: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: { paddingLeft: Spacing[4] },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[3],
    paddingRight: Spacing[4],
    minHeight: 44,
  },
  rowText: { flex: 1 },

  sectionSubtitle: {
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
});
