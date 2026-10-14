import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

interface Props {
  visible: boolean;
  /** How many captures exist — the promise speaks about them. */
  fragmentCount: number;
  /** "Not now". The ask may come back later, as the primer; see lib/push-ask.ts. */
  onDecline: () => void;
  /** Proceed to the system prompt. */
  onAccept: () => void;
}

/**
 * The comeback promise — and the push permission ask, fused. The product's
 * spine is "what you save comes back to you", which can't be FELT in session
 * one; so at the moment of maximum belief (their own thoughts just connected
 * on the map) mneme states the promise concretely about THEIR fragments, and
 * that statement is the permission ask. Replaces the old onboarding primer
 * slide, which asked before the app had earned anything.
 *
 * The promise is the one the engine actually keeps: it speaks when the map
 * notices something (see services/resurface.ts), and checks in when the
 * user has gone quiet — not "tomorrow morning", which nothing guarantees.
 *
 * Same ask state as PushPrimer (lib/push-ask.ts): "turn on" spends the one
 * system prompt, "not now" holds the card back for a while.
 */
export function ComebackPromise({ visible, fragmentCount, onDecline, onAccept }: Props) {
  const c = useThemeColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="h4" style={{ marginBottom: Spacing[3] }}>
            On your map
          </Text>

          <Text variant="body" color="secondary">
            {fragmentCount === 1
              ? 'That thought is on your map now. As more land, Mneme starts to notice things: two that disagree, a thread picking up, a streak worth keeping.'
              : 'Those thoughts are on your map now. As more land, Mneme starts to notice things: two that disagree, a thread picking up, a streak worth keeping.'}
          </Text>

          <Text variant="body" style={{ marginTop: Spacing[4] }}>
            Want a reminder when your streak needs a save?
          </Text>

          <Text variant="caption" color="muted" style={{ marginTop: Spacing[5] }}>
            A few a day at most. No badges.
          </Text>

          <View style={styles.actions}>
            <Button label="Not now" variant="tertiary" size="sm" onPress={onDecline} />
            <Button label="Turn on" variant="primary" size="sm" onPress={onAccept} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,9,7,0.5)',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[16],
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[6],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing[2],
    marginTop: Spacing[6],
  },
});
