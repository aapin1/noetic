import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

interface Props {
  visible: boolean;
  /** How many captures exist — the promise speaks about them. */
  fragmentCount: number;
  /** Declined. We never show this again either way. */
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
 * Same one-shot discipline as PushPrimer: iOS grants one system prompt per
 * install, so both paths mark the ask spent.
 */
export function ComebackPromise({ visible, fragmentCount, onDecline, onAccept }: Props) {
  const c = useThemeColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2, marginBottom: Spacing[3] }}>
            ON YOUR MAP
          </Text>

          <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
            {fragmentCount === 1
              ? 'that thought is on your map now. as more land, mneme starts to notice things — two that disagree, a thread picking up.'
              : 'those thoughts are on your map now. as more land, mneme starts to notice things — two that disagree, a thread picking up.'}
          </Text>

          <Text variant="serif" style={{ lineHeight: 26, marginTop: Spacing[4], color: c.text }}>
            want a nudge when that happens?
          </Text>

          <Text variant="monoSmall" style={{ color: c.faint, marginTop: Spacing[5], letterSpacing: 1 }}>
            once a day at most. no badges.
          </Text>

          <View style={styles.actions}>
            <Pressable onPress={onDecline} hitSlop={8} style={styles.action}>
              <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                not now
              </Text>
            </Pressable>
            <Pressable onPress={onAccept} hitSlop={8} style={styles.action}>
              <Text variant="monoSmall" style={{ color: c.text, letterSpacing: 1 }}>
                yes →
              </Text>
            </Pressable>
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
    gap: Spacing[6],
    marginTop: Spacing[6],
  },
  action: {
    paddingVertical: Spacing[2],
  },
});
