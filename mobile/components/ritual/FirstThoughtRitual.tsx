import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { api } from '@/lib/api';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { GLASS_BG, GLASS_BORDER } from '@/constants/mapPalette';
import { useDisclosure } from '@/contexts/DisclosureContext';
import { EVENT_FLAGS } from '@/lib/disclosure';
import {
  hasOwnEdge,
  ritualInitial,
  ritualPrompt,
  ritualReduce,
  type RitualEndReason,
} from '@/lib/firstSession';
import { failureReason, track } from '@/lib/analytics';
import { noteCaptureForReview } from '@/lib/review';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Text } from '@/components/ui/Text';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';

/** How long the aha line holds the stage before the ritual yields. */
const AHA_HOLD_MS = 2600;

const INK = 'rgba(240,232,214,0.84)';
const INK_MUTED = 'rgba(240,232,214,0.6)';
const INK_FAINT = 'rgba(240,232,214,0.42)';

interface Props {
  /** Live graph edges — the aha detector watches these for a fragment↔fragment edge. */
  edges: readonly { fromItemId: string; toItemId: string }[];
  /**
   * Captures landed through other doors (the + composer) while the ritual is
   * up. They count as fragments: the prompt is an invitation, not the only
   * way in.
   */
  externalCaptureIds: readonly string[];
  /** Fired after each landed fragment so the host refetches the map. */
  onCaptured: () => void;
  /**
   * The ritual has fully yielded the stage. `fragmentIds` are the captures it
   * landed, in order — the host decides what the moment has earned (the
   * comeback promise needs at least one).
   */
  onDone: (reason: RitualEndReason, fragmentIds: string[]) => void;
}

/**
 * The thought-first capture ritual, performed over the demo map. Deliberately
 * ONE small card: a question, an input, a mic — nothing else until there is
 * something to save. Each fragment lands as a real node; then, gently, "what
 * else?", chaining only until the first edge draws between the user's own
 * thoughts. The ritual ends at the aha and never milks. The ✕ dismisses it
 * guilt-free at any beat, and links are never requested — people carry
 * thoughts, not URLs (the + composer is right there for everything else).
 */
export function FirstThoughtRitual({ edges, externalCaptureIds, onCaptured, onDone }: Props) {
  const { markSeen } = useDisclosure();
  const [state, dispatch] = useReducer(ritualReduce, undefined, ritualInitial);
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');
  const finishedRef = useRef(false);

  // Fragments that arrived through the composer rather than this card.
  useEffect(() => {
    for (const id of externalCaptureIds) {
      dispatch({ type: 'CAPTURED', id });
    }
  }, [externalCaptureIds]);

  // The aha detector. Edges arrive with the graph refetch after a landed
  // fragment; the reducer ignores this before two own fragments exist.
  useEffect(() => {
    if (state.step === 'done') return;
    if (hasOwnEdge(state.fragments, edges)) dispatch({ type: 'EDGE_FOUND' });
  }, [edges, state.step, state.fragments]);

  const submit = useCallback(() => {
    const thought = text.trim();
    if (!thought || state.step !== 'prompt') return;
    Keyboard.dismiss();
    dispatch({ type: 'SUBMIT' });
    setHint('');
    const startedAt = Date.now();
    track('capture_started', { kind: 'TEXT', source: 'ritual' });
    void api.captures
      .create({ kind: 'TEXT', text: thought })
      .then((res) => {
        track('capture_succeeded', {
          kind: 'TEXT',
          source: 'ritual',
          duration_ms: Date.now() - startedAt,
        });
        noteCaptureForReview();
        setText('');
        dispatch({ type: 'CAPTURED', id: res.id });
        onCaptured();
      })
      .catch((e) => {
        track('capture_failed', {
          kind: 'TEXT',
          source: 'ritual',
          duration_ms: Date.now() - startedAt,
          reason: failureReason(e),
        });
        setHint("that didn't save — try again.");
        dispatch({ type: 'CAPTURE_FAILED' });
      });
  }, [text, state.step, onCaptured]);

  const skip = useCallback(() => {
    Keyboard.dismiss();
    dispatch({ type: 'SKIP' });
  }, []);

  // Yield the stage exactly once. A skip yields immediately; an earned ending
  // holds the aha line for a beat first.
  useEffect(() => {
    if (state.step !== 'done' || finishedRef.current) return;
    finishedRef.current = true;
    markSeen(EVENT_FLAGS.ritualDone);
    const reason = state.endReason ?? 'skipped';
    track('onboarding_step', {
      step: 'ritual',
      action: reason === 'skipped' && state.fragments.length === 0 ? 'skipped' : 'completed',
    });
    if (reason === 'skipped') {
      onDone(reason, state.fragments);
      return;
    }
    const timer = setTimeout(() => onDone(reason, state.fragments), AHA_HOLD_MS);
    return () => clearTimeout(timer);
  }, [state, markSeen, onDone]);

  if (state.step === 'done') {
    if ((state.endReason ?? 'skipped') === 'skipped') return null;
    return (
      <View style={styles.host} pointerEvents="none">
        <View style={[styles.card, styles.ahaCard]}>
          <Text variant="monoSmall" style={{ color: INK, letterSpacing: 0.5 }}>
            {state.endReason === 'edge'
              ? 'there — your first connection.'
              : 'enough for now — your map has begun.'}
          </Text>
        </View>
      </View>
    );
  }

  if (state.step === 'waiting') {
    return (
      <View style={styles.host} pointerEvents="box-none">
        <View style={[styles.card, styles.ahaCard]}>
          <LoadingDots size={4} />
          <Text variant="monoSmall" style={{ color: INK_MUTED, marginLeft: Spacing[3] }}>
            placing it on your map…
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.host}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text variant="monoSmall" style={{ color: INK, letterSpacing: 0.5, flex: 1 }}>
            {ritualPrompt(state)}
          </Text>
          <Pressable onPress={skip} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text variant="monoSmall" style={{ color: INK_FAINT }}>✕</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="a thought is enough"
          placeholderTextColor={INK_FAINT}
          multiline
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={submit}
        />
        {!!hint && (
          <Text variant="monoSmall" style={{ color: INK_FAINT, marginBottom: Spacing[2] }}>
            {hint}
          </Text>
        )}
        <View style={styles.row}>
          <VoiceNoteButton
            onText={(t) => setText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))}
            onError={setHint}
          />
          {/* The save action appears only once there is something to save —
              until then the card is just a question and a place to answer. */}
          {text.trim() ? (
            <Pressable
              onPress={submit}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Put this thought on the map"
            >
              <Text variant="monoSmall" style={{ color: INK }}>
                save →
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
    paddingHorizontal: Spacing[5],
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: GLASS_BG,
    borderColor: GLASS_BORDER,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[4],
  },
  ahaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  input: {
    color: 'rgba(240,232,214,0.9)',
    fontFamily: FontFamily.mono,
    fontSize: FontSize.base,
    lineHeight: 22,
    minHeight: 44,
    maxHeight: 110,
    marginTop: Spacing[3],
    marginBottom: Spacing[3],
    padding: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 34,
  },
});
