import React, { useCallback, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import {
  GLASS_ACTIVE_BG,
  GLASS_BORDER,
  GLASS_BORDER_GLOW,
  GLASS_SEP,
  MAP_BG,
} from '@/constants/mapPalette';
import { Text } from '@/components/ui/Text';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { RecognizeKind, RecognizePreview } from '@/types/api';

/**
 * The recognition opener: instead of asking a brand-new user to produce a URL
 * or a thought, ask them to point at something that stuck with them. A work
 * they love, a thought, a quote, or a link. Recognition, not production, is
 * the first ask, and understanding is a ladder that never fails silently:
 * catalogues → the model's own knowledge → the person themselves.
 *
 * Layout rule: one fixed-height sheet pinned to the bottom edge, no
 * scrolling. Every stage lays its content out top-down in the same frame.
 */

/** The named-work kinds the server resolver speaks, plus the person's own words. */
type SheetKind = RecognizeKind | 'thought' | 'quote';

const KINDS: { key: SheetKind; label: string }[] = [
  { key: 'book', label: 'book' },
  { key: 'film', label: 'film' },
  { key: 'tv', label: 'show' },
  { key: 'anime', label: 'anime' },
  { key: 'game', label: 'game' },
  { key: 'album', label: 'album' },
  { key: 'thought', label: 'thought' },
  { key: 'quote', label: 'quote' },
];

/** Broadly-known works, one per resolver kind: recognition without typing. */
const EXAMPLES: { title: string; kind: RecognizeKind }[] = [
  { title: 'Sapiens', kind: 'book' },
  { title: 'Interstellar', kind: 'film' },
  { title: 'Breaking Bad', kind: 'tv' },
  { title: 'Spirited Away', kind: 'anime' },
  { title: 'Elden Ring', kind: 'game' },
  { title: 'Abbey Road', kind: 'album' },
];

/** Matches the composer's idea of "already looks like a URL". */
const URL_RE = /^(https?:\/\/\S+|[\w-]+(\.[a-z]{2,})+(\/\S*)?)$/i;

const INK = 'rgba(240,232,214,0.9)';
const INK_MUTED = 'rgba(240,232,214,0.62)';
const INK_FAINT = 'rgba(240,232,214,0.42)';
const ACCENT = '#7EC8A0';
const DANGER = '#E08A7A';

type Stage = 'input' | 'resolving' | 'confirm' | 'probe' | 'committing' | 'landed';

/** What the sheet hands up when the person commits. The host owns the API. */
export type RecognitionCommit =
  | { mode: 'work'; title: string; kind: RecognizeKind; year?: number; words?: string; context?: string }
  | { mode: 'text'; kind: 'TEXT' | 'QUOTE'; text: string; context?: string }
  | { mode: 'link'; url: string };

interface Props {
  visible: boolean;
  /** Captures already on the map: drives the "two more…" line. */
  capturedCount: number;
  onClose: (stage: 'input' | 'confirm' | 'done') => void;
  /** Runs the capture; resolves once the node is on the map. */
  onCommit: (args: RecognitionCommit) => Promise<void>;
}

export function RecognitionSheet({ visible, capturedCount, onClose, onCommit }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('input');
  const [entry, setEntry] = useState('');
  const [kind, setKind] = useState<SheetKind | null>(null);
  // Set when a "maybe you meant" pick carried one; disambiguates the commit.
  const [year, setYear] = useState<number | undefined>(undefined);
  const [preview, setPreview] = useState<RecognizePreview | null>(null);
  const [words, setWords] = useState('');
  // Rung three of the understanding ladder: the person's own account. What
  // an unfound work IS, or their answer to the probing questions.
  const [context, setContext] = useState('');
  const [probeQuestions, setProbeQuestions] = useState<string[]>([]);
  const [error, setError] = useState('');
  // Landed count this sheet session: the close-vs-skip signal, and the
  // "two more…" copy between a commit and the map refetch reporting it.
  const [landed, setLanded] = useState(0);

  const isWorkKind = (k: SheetKind | null): k is RecognizeKind => k !== null && k !== 'thought' && k !== 'quote';
  const looksLikeUrl = URL_RE.test(entry.trim());

  // Stage changes while the keyboard is up leave KeyboardAvoidingView holding
  // stale padding inside the Modal, which lifted the sheet off the bottom edge
  // and clipped the landed stage. Every transition drops the keyboard first.
  const goStage = useCallback((next: Stage) => {
    Keyboard.dismiss();
    setStage(next);
  }, []);

  const reset = useCallback(() => {
    goStage('input');
    setEntry('');
    setKind(null);
    setYear(undefined);
    setPreview(null);
    setWords('');
    setContext('');
    setProbeQuestions([]);
    setError('');
  }, [goStage]);

  const close = useCallback(() => {
    if (landed > 0) {
      onClose('done');
    } else {
      const skippedFrom = stage === 'input' || stage === 'resolving' ? 'input' : 'confirm';
      track('recognition_skipped', { stage: skippedFrom });
      onClose(skippedFrom);
    }
    setLanded(0);
    reset();
  }, [landed, onClose, reset, stage]);

  const runCommit = useCallback(
    async (args: RecognitionCommit) => {
      goStage('committing');
      try {
        await onCommit(args);
        const index = landed + 1;
        setLanded(index);
        track('recognition_captured', { index });
        goStage('landed');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'couldn’t save that. try again?');
        goStage(args.mode === 'work' ? 'confirm' : 'input');
      }
    },
    [goStage, landed, onCommit],
  );

  const resolveWork = useCallback(async (lookupTitle: string, lookupKind: RecognizeKind, lookupYear?: number) => {
    setError('');
    goStage('resolving');
    try {
      const found = await api.captures.recognizePreview({ title: lookupTitle, kind: lookupKind, year: lookupYear });
      track('recognition_resolved', { kind: lookupKind, hit: found.hit });
      setPreview(found);
      goStage('confirm');
    } catch {
      // Network hiccup ≠ "not found": let them retry rather than mislabel it.
      setError('couldn’t look that up. try again?');
      goStage('input');
    }
  }, [goStage]);

  // The one CTA on the input stage, routed by what they gave us: a link goes
  // straight to the pipeline (it reads the page itself), a named work goes to
  // the resolver, their own words go past the weak-material judge first.
  const submitEntry = useCallback(async () => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (looksLikeUrl) {
      await runCommit({ mode: 'link', url: trimmed });
      return;
    }
    if (isWorkKind(kind)) {
      setEntry(trimmed);
      setYear(undefined);
      await resolveWork(trimmed, kind);
      return;
    }
    if (kind === 'thought' || kind === 'quote') {
      setError('');
      goStage('resolving');
      let questions: string[] = [];
      try {
        const res = await api.captures.recognizeProbe({ kind, text: trimmed });
        questions = res.questions;
      } catch {
        // The judge being down never blocks a save.
      }
      track('recognition_probed', { questions: questions.length });
      if (questions.length > 0) {
        setProbeQuestions(questions);
        goStage('probe');
        return;
      }
      await runCommit({ mode: 'text', kind: kind === 'quote' ? 'QUOTE' : 'TEXT', text: trimmed });
    }
  }, [entry, kind, looksLikeUrl, goStage, resolveWork, runCommit]);

  const commitWork = useCallback(async () => {
    if (!isWorkKind(kind)) return;
    await runCommit({
      mode: 'work',
      title: entry.trim(),
      kind,
      year,
      words: words.trim() || undefined,
      context: context.trim() || undefined,
    });
  }, [kind, entry, year, words, context, runCommit]);

  const commitProbed = useCallback(
    async (withAnswer: boolean) => {
      if (kind !== 'thought' && kind !== 'quote') return;
      await runCommit({
        mode: 'text',
        kind: kind === 'quote' ? 'QUOTE' : 'TEXT',
        text: entry.trim(),
        context: withAnswer ? context.trim() || undefined : undefined,
      });
    },
    [kind, entry, context, runCommit],
  );

  // How many more until the map starts speaking back (the MIRROR arrives at
  // three). The prop refreshes via the map refetch; the local count covers the
  // gap between a commit landing and that refetch reporting it.
  const captured = Math.max(capturedCount, landed);
  const remaining = Math.max(0, 3 - captured);

  const inputPlaceholder =
    kind === 'thought' ? 'what’s on your mind?'
      : kind === 'quote' ? 'the line, as you remember it'
        : 'a title, a thought, or a link';

  const ctaLabel = looksLikeUrl ? 'put it on the map'
    : kind === 'thought' || kind === 'quote' ? 'add it'
      : 'find it';

  const canSubmit = entry.trim().length > 0 && (looksLikeUrl || kind !== null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={close} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + Spacing[4], backgroundColor: MAP_BG, borderColor: GLASS_BORDER_GLOW },
            ]}
          >
            <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={{ color: INK_FAINT, fontSize: 16 }}>✕</Text>
            </Pressable>

            {stage === 'input' && (
              <View>
                <Text variant="h1" style={[styles.ask, { color: INK }]}>
                  Name one thing that stuck with you.
                </Text>
                <TextInput
                  value={entry}
                  onChangeText={setEntry}
                  placeholder={inputPlaceholder}
                  placeholderTextColor={INK_FAINT}
                  style={[styles.input, { borderColor: GLASS_BORDER, color: INK }]}
                  autoCorrect={kind === 'thought' || kind === 'quote'}
                  multiline={kind === 'thought' || kind === 'quote'}
                  returnKeyType={kind === 'thought' || kind === 'quote' ? 'default' : 'search'}
                  onSubmitEditing={() => void submitEntry()}
                />
                {looksLikeUrl ? (
                  <Text variant="monoSmall" style={{ color: INK_FAINT, marginBottom: Spacing[3] }}>
                    that’s a link. mneme will read the page itself.
                  </Text>
                ) : (
                  <View style={styles.chips}>
                    {KINDS.map((k) => (
                      <Pressable
                        key={k.key}
                        onPress={() => setKind(k.key)}
                        style={[
                          styles.chip,
                          { borderColor: kind === k.key ? GLASS_BORDER_GLOW : GLASS_BORDER },
                          kind === k.key && { backgroundColor: GLASS_ACTIVE_BG },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: kind === k.key }}
                      >
                        <Text variant="monoSmall" style={{ color: kind === k.key ? INK : INK_MUTED }}>
                          {k.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {error ? (
                  <Text variant="caption" style={{ marginBottom: Spacing[3], color: DANGER }}>
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void submitEntry()}
                  disabled={!canSubmit}
                  style={[
                    styles.primaryBtn,
                    { borderColor: GLASS_BORDER_GLOW, backgroundColor: GLASS_ACTIVE_BG },
                    !canSubmit && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={ctaLabel}
                >
                  <Text variant="bodyMedium" style={{ color: INK }}>
                    {ctaLabel}
                  </Text>
                </Pressable>

                <View style={[styles.sep, { backgroundColor: GLASS_SEP }]} />
                <Text variant="monoSmall" style={{ color: INK_FAINT, marginBottom: Spacing[2] }}>
                  or tap a classic:
                </Text>
                <View style={styles.chips}>
                  {EXAMPLES.map((ex) => (
                    <Pressable
                      key={ex.title}
                      onPress={() => {
                        setEntry(ex.title);
                        setKind(ex.kind);
                        void resolveWork(ex.title, ex.kind);
                      }}
                      style={[styles.chip, { borderColor: GLASS_BORDER }]}
                      accessibilityRole="button"
                    >
                      <Text variant="monoSmall" style={{ color: INK_MUTED }}>
                        {ex.title}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  onPress={() => {
                    close();
                    router.push('/connections' as never);
                  }}
                  hitSlop={8}
                  style={styles.footer}
                  accessibilityRole="link"
                >
                  <Text variant="monoSmall" style={{ color: INK_FAINT }}>
                    log books or films elsewhere? connect an account →
                  </Text>
                </Pressable>
              </View>
            )}

            {(stage === 'resolving' || stage === 'committing') && (
              <View style={styles.loading}>
                <AsciiLoader
                  inline
                  variant={stage === 'resolving' ? 'cat' : 'mail'}
                  size={34}
                  color={INK_MUTED}
                />
                <Text variant="monoSmall" style={{ color: INK_MUTED, marginTop: Spacing[3] }}>
                  {stage === 'committing' ? 'reading & mapping…'
                    : isWorkKind(kind) ? 'looking it up…' : 'reading it…'}
                </Text>
              </View>
            )}

            {stage === 'confirm' && (
              <View>
                {preview?.hit ? (
                  <View style={[styles.card, { borderColor: GLASS_BORDER }]}>
                    {preview.imageUrl ? (
                      <Image source={{ uri: preview.imageUrl }} style={styles.cover} contentFit="cover" transition={150} />
                    ) : null}
                    <View style={styles.cardBody}>
                      <Text variant="bodyMedium" style={{ color: INK }}>
                        {preview.title}
                      </Text>
                      {preview.author ? (
                        <Text variant="monoSmall" style={{ color: INK_FAINT, marginTop: 2 }}>
                          {preview.author}
                        </Text>
                      ) : null}
                      {preview.description ? (
                        <Text variant="caption" style={{ color: INK_MUTED, marginTop: Spacing[2] }} numberOfLines={4}>
                          {preview.description}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : (
                  <>
                    <Text variant="body" style={{ color: INK_MUTED, marginBottom: Spacing[3] }}>
                      mneme doesn’t know “{entry.trim()}” yet. tell it what this is.
                    </Text>
                    <TextInput
                      value={context}
                      onChangeText={setContext}
                      placeholder="what it is, in a line or two"
                      placeholderTextColor={INK_FAINT}
                      style={[styles.input, { borderColor: GLASS_BORDER, color: INK }]}
                      multiline
                    />
                  </>
                )}
                {(preview?.alternatives?.length ?? 0) > 0 && (
                  <>
                    <Text variant="monoSmall" style={{ color: INK_FAINT, marginBottom: Spacing[2] }}>
                      {preview?.hit ? 'not this one? maybe you meant:' : 'maybe you meant:'}
                    </Text>
                    <View style={styles.chips}>
                      {preview?.alternatives?.map((alt) => (
                        <Pressable
                          key={`${alt.title}|${alt.year ?? ''}`}
                          onPress={() => {
                            if (!isWorkKind(kind)) return;
                            setEntry(alt.title);
                            setYear(alt.year);
                            void resolveWork(alt.title, kind, alt.year);
                          }}
                          style={[styles.chip, { borderColor: GLASS_BORDER }]}
                          accessibilityRole="button"
                        >
                          <Text variant="monoSmall" style={{ color: INK_MUTED }}>
                            {alt.title}
                            {alt.hint ? ` · ${alt.hint}` : alt.year ? ` · ${alt.year}` : ''}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
                <TextInput
                  value={words}
                  onChangeText={setWords}
                  placeholder="why did it stick? optional"
                  placeholderTextColor={INK_FAINT}
                  style={[styles.input, { borderColor: GLASS_BORDER, color: INK }]}
                  maxLength={500}
                  returnKeyType="done"
                />
                {captured === 0 && (
                  <Text variant="monoSmall" style={{ color: INK_FAINT, marginBottom: Spacing[2] }}>
                    a line from you makes the first reading yours.
                  </Text>
                )}
                {error ? (
                  <Text variant="caption" style={{ marginBottom: Spacing[3], color: DANGER }}>
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void commitWork()}
                  style={[styles.primaryBtn, { borderColor: GLASS_BORDER_GLOW, backgroundColor: GLASS_ACTIVE_BG }]}
                  accessibilityRole="button"
                  accessibilityLabel="Put it on the map"
                >
                  <Text variant="bodyMedium" style={{ color: INK }}>
                    put it on the map
                  </Text>
                </Pressable>
                <Pressable onPress={() => goStage('input')} hitSlop={8} style={styles.backLink} accessibilityRole="button">
                  <Text variant="monoSmall" style={{ color: INK_FAINT }}>
                    {preview?.hit ? 'not it? search again' : '← back'}
                  </Text>
                </Pressable>
              </View>
            )}

            {stage === 'probe' && (
              <View>
                <Text variant="body" style={{ color: INK_MUTED, marginBottom: Spacing[3] }}>
                  mneme wants to understand this well enough to say something back:
                </Text>
                {probeQuestions.map((q) => (
                  <Text key={q} variant="bodyMedium" style={{ color: INK, marginBottom: Spacing[2] }}>
                    {q}
                  </Text>
                ))}
                <View style={styles.answerRow}>
                  <TextInput
                    value={context}
                    onChangeText={setContext}
                    placeholder="type or speak your answer"
                    placeholderTextColor={INK_FAINT}
                    style={[styles.input, styles.answerInput, { borderColor: GLASS_BORDER, color: INK }]}
                    multiline
                  />
                  <VoiceNoteButton
                    onText={(t) => setContext((prev) => (prev ? `${prev} ${t}` : t))}
                    onError={(m) => setError(m)}
                  />
                </View>
                {error ? (
                  <Text variant="caption" style={{ marginBottom: Spacing[3], color: DANGER }}>
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void commitProbed(true)}
                  style={[styles.primaryBtn, { borderColor: GLASS_BORDER_GLOW, backgroundColor: GLASS_ACTIVE_BG }]}
                  accessibilityRole="button"
                  accessibilityLabel="Put it on the map"
                >
                  <Text variant="bodyMedium" style={{ color: INK }}>
                    put it on the map
                  </Text>
                </Pressable>
                <Pressable onPress={() => void commitProbed(false)} hitSlop={8} style={styles.backLink} accessibilityRole="button">
                  <Text variant="monoSmall" style={{ color: INK_FAINT }}>
                    save it as is →
                  </Text>
                </Pressable>
              </View>
            )}

            {stage === 'landed' && (
              <View>
                <Text variant="h1" style={[styles.ask, { color: INK }]}>
                  <Text variant="h1" style={{ color: ACCENT }}>✓</Text>{' '}
                  {captured === 1 ? 'you’ve started growing your map.' : 'it’s on your map.'}
                </Text>
                <Text variant="body" style={{ color: INK_MUTED, marginBottom: Spacing[5] }}>
                  {remaining >= 2
                    ? 'two more and the map starts reading you.'
                    : remaining === 1
                      ? 'one more and the map starts reading you.'
                      : 'connected into the rest of your map.'}
                </Text>
                <Pressable
                  onPress={reset}
                  style={[styles.primaryBtn, { borderColor: GLASS_BORDER_GLOW, backgroundColor: GLASS_ACTIVE_BG }]}
                  accessibilityRole="button"
                >
                  <Text variant="bodyMedium" style={{ color: INK }}>
                    name another
                  </Text>
                </Pressable>
                <Pressable onPress={close} hitSlop={8} style={styles.backLink} accessibilityRole="button">
                  <Text variant="monoSmall" style={{ color: INK_FAINT }}>
                    take me to the map →
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,4,3,0.55)' },
  backdropTouch: StyleSheet.absoluteFill as object,
  sheet: {
    // Fixed and tall: every stage fits without scrolling, and the frame never
    // hops between stages. Pinned to the true bottom edge, no gap.
    height: '78%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
  },
  closeBtn: { alignSelf: 'flex-end', padding: Spacing[1], marginBottom: Spacing[2] },
  ask: { marginBottom: Spacing[4] },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    fontFamily: FontFamily.mono,
    fontSize: FontSize.md,
    marginBottom: Spacing[3],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginBottom: Spacing[3] },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
  },
  primaryBtn: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing[3],
    alignItems: 'center',
    marginTop: Spacing[2],
  },
  disabled: { opacity: 0.4 },
  sep: { height: 1, marginVertical: Spacing[5] },
  footer: { marginTop: Spacing[5] },
  loading: { alignItems: 'center', paddingVertical: Spacing[10] },
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing[3],
    marginBottom: Spacing[3],
    gap: Spacing[3],
  },
  cover: { width: 56, height: 80, borderRadius: 6, backgroundColor: 'rgba(240,232,214,0.06)' },
  cardBody: { flex: 1 },
  answerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[2] },
  answerInput: { flex: 1 },
  backLink: { alignSelf: 'center', marginTop: Spacing[4], padding: Spacing[1] },
});
