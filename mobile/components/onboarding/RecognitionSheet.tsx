import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { RecognizeKind, RecognizePreview } from '@/types/api';

/**
 * The recognition opener: instead of asking a brand-new user to produce a URL
 * or a thought, ask them to point at something they already love. A named
 * work becomes a real first capture through the server's keyless resolver —
 * recognition, not production, is the first ask.
 */

const KINDS: { key: RecognizeKind; label: string }[] = [
  { key: 'book', label: 'book' },
  { key: 'film', label: 'film' },
  { key: 'tv', label: 'show' },
  { key: 'anime', label: 'anime' },
  { key: 'game', label: 'game' },
  { key: 'album', label: 'album' },
];

/** Broadly-known works, one per kind — recognition without typing. */
const EXAMPLES: { title: string; kind: RecognizeKind }[] = [
  { title: 'Sapiens', kind: 'book' },
  { title: 'Interstellar', kind: 'film' },
  { title: 'Breaking Bad', kind: 'tv' },
  { title: 'Spirited Away', kind: 'anime' },
  { title: 'Elden Ring', kind: 'game' },
  { title: 'Abbey Road', kind: 'album' },
];

const INK = 'rgba(240,232,214,0.9)';
const INK_MUTED = 'rgba(240,232,214,0.62)';
const INK_FAINT = 'rgba(240,232,214,0.42)';
const ACCENT = '#7EC8A0';

type Stage = 'input' | 'resolving' | 'confirm' | 'committing' | 'landed';

interface Props {
  visible: boolean;
  /** Captures already on the map — drives the "two more…" line. */
  capturedCount: number;
  onClose: (stage: 'input' | 'confirm' | 'done') => void;
  /** Runs the capture; resolves once the node is on the map. */
  onCommit: (args: { title: string; kind: RecognizeKind; words?: string }) => Promise<void>;
  /** "or take the quick tour instead" — offered from the welcome flow only. */
  onTour?: () => void;
}

export function RecognitionSheet({ visible, capturedCount, onClose, onCommit, onTour }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('input');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RecognizeKind | null>(null);
  const [preview, setPreview] = useState<RecognizePreview | null>(null);
  const [words, setWords] = useState('');
  const [error, setError] = useState('');
  // Landed count this sheet session — the close-vs-skip signal, and the
  // "two more…" copy between a commit and the map refetch reporting it.
  const [landed, setLanded] = useState(0);

  const reset = useCallback(() => {
    setStage('input');
    setTitle('');
    setKind(null);
    setPreview(null);
    setWords('');
    setError('');
  }, []);

  const close = useCallback(() => {
    if (landed > 0) {
      onClose('done');
    } else {
      const skippedFrom = stage === 'confirm' || stage === 'committing' ? 'confirm' : 'input';
      track('recognition_skipped', { stage: skippedFrom });
      onClose(skippedFrom);
    }
    setLanded(0);
    reset();
  }, [landed, onClose, reset, stage]);

  const resolve = useCallback(
    async (lookupTitle: string, lookupKind: RecognizeKind) => {
      const trimmed = lookupTitle.trim();
      if (!trimmed) return;
      setTitle(trimmed);
      setKind(lookupKind);
      setError('');
      setStage('resolving');
      try {
        const found = await api.captures.recognizePreview({ title: trimmed, kind: lookupKind });
        track('recognition_resolved', { kind: lookupKind, hit: found.hit });
        setPreview(found);
        setStage('confirm');
      } catch {
        // Network hiccup ≠ "not found": let them retry rather than mislabel it.
        setError('couldn’t look that up — try again?');
        setStage('input');
      }
    },
    [],
  );

  const commit = useCallback(async () => {
    if (!kind) return;
    setStage('committing');
    try {
      await onCommit({ title, kind, words: words.trim() || undefined });
      const index = landed + 1;
      setLanded(index);
      track('recognition_captured', { index });
      setStage('landed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again?');
      setStage('confirm');
    }
  }, [kind, title, words, landed, onCommit]);

  const another = useCallback(() => {
    reset();
  }, [reset]);

  // How many more until the map starts speaking back (the MIRROR arrives at
  // three). The prop refreshes via the map refetch; the local count covers the
  // gap between a commit landing and that refetch reporting it.
  const remaining = Math.max(0, 3 - Math.max(capturedCount, landed));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={close} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + Spacing[6], backgroundColor: MAP_BG, borderColor: GLASS_BORDER_GLOW },
            ]}
          >
            <View style={styles.header}>
              <Text variant="monoSmall" style={{ color: INK_MUTED, letterSpacing: 1 }}>
                {stage === 'landed' ? 'on the map' : 'start with what stuck'}
              </Text>
              <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={{ color: INK_FAINT, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            {stage === 'input' && (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text variant="h1" style={[styles.ask, { color: INK }]}>
                  Name one thing that stuck with you.
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="a title is enough"
                  placeholderTextColor={INK_FAINT}
                  style={[styles.input, { borderColor: GLASS_BORDER, color: INK }]}
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() => kind && resolve(title, kind)}
                />
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
                {error ? (
                  <Text variant="caption" style={[{ marginBottom: Spacing[3], color: '#E08A7A' }]}>
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => kind && resolve(title, kind)}
                  disabled={!title.trim() || !kind}
                  style={[
                    styles.primaryBtn,
                    { borderColor: GLASS_BORDER_GLOW, backgroundColor: GLASS_ACTIVE_BG },
                    (!title.trim() || !kind) && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Find this work"
                >
                  <Text variant="bodyMedium" style={{ color: INK }}>
                    find it
                  </Text>
                </Pressable>

                <View style={[styles.sep, { backgroundColor: GLASS_SEP }]} />
                <Text variant="monoSmall" style={{ color: INK_FAINT, marginBottom: Spacing[2] }}>
                  or tap one you know:
                </Text>
                <View style={styles.chips}>
                  {EXAMPLES.map((ex) => (
                    <Pressable
                      key={ex.title}
                      onPress={() => void resolve(ex.title, ex.kind)}
                      style={[styles.chip, { borderColor: GLASS_BORDER }]}
                      accessibilityRole="button"
                    >
                      <Text variant="monoSmall" style={{ color: INK_MUTED }}>
                        {ex.title}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.footer}>
                  <Pressable
                    onPress={() => {
                      close();
                      router.push('/connections' as never);
                    }}
                    hitSlop={8}
                    accessibilityRole="link"
                  >
                    <Text variant="monoSmall" style={{ color: INK_FAINT }}>
                      already log books or films somewhere? connect an account →
                    </Text>
                  </Pressable>
                  {onTour && (
                    <Pressable onPress={onTour} hitSlop={8} style={{ marginTop: Spacing[3] }} accessibilityRole="link">
                      <Text variant="monoSmall" style={{ color: INK_FAINT }}>
                        or take the quick tour instead →
                      </Text>
                    </Pressable>
                  )}
                </View>
              </ScrollView>
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
                  {stage === 'resolving' ? 'looking it up…' : 'reading & mapping…'}
                </Text>
              </View>
            )}

            {stage === 'confirm' && (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                  <Text variant="body" style={{ color: INK_MUTED, marginBottom: Spacing[2] }}>
                    couldn’t find “{title}” out there — save it anyway and mneme will keep it in your words.
                  </Text>
                )}
                <TextInput
                  value={words}
                  onChangeText={setWords}
                  placeholder="why did it stick? one line, optional"
                  placeholderTextColor={INK_FAINT}
                  style={[styles.input, { borderColor: GLASS_BORDER, color: INK }]}
                  maxLength={500}
                  returnKeyType="done"
                />
                {error ? (
                  <Text variant="caption" style={[{ marginBottom: Spacing[3], color: '#E08A7A' }]}>
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void commit()}
                  style={[styles.primaryBtn, { borderColor: GLASS_BORDER_GLOW, backgroundColor: GLASS_ACTIVE_BG }]}
                  accessibilityRole="button"
                  accessibilityLabel="Put it on the map"
                >
                  <Text variant="bodyMedium" style={{ color: INK }}>
                    {preview?.hit ? 'put it on the map' : 'save it anyway'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setStage('input')} hitSlop={8} style={styles.backLink} accessibilityRole="button">
                  <Text variant="monoSmall" style={{ color: INK_FAINT }}>
                    {preview?.hit ? 'not it — search again' : '← back'}
                  </Text>
                </Pressable>
              </ScrollView>
            )}

            {stage === 'landed' && (
              <View>
                <Text variant="h1" style={[styles.ask, { color: INK }]}>
                  <Text variant="h1" style={{ color: ACCENT }}>✓</Text> it’s on your map.
                </Text>
                <Text variant="body" style={{ color: INK_MUTED, marginBottom: Spacing[5] }}>
                  {remaining >= 2
                    ? 'two more and the map starts reading you.'
                    : remaining === 1
                      ? 'one more and the map starts reading you.'
                      : 'the map is forming — watch the lines.'}
                </Text>
                <Pressable
                  onPress={another}
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
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[5],
    maxHeight: '86%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[4],
  },
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
  footer: { marginTop: Spacing[5], marginBottom: Spacing[2] },
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
  backLink: { alignSelf: 'center', marginTop: Spacing[4], padding: Spacing[1] },
});
