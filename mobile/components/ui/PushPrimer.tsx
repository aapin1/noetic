import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from './Text';

interface Props {
  visible: boolean;
  /** "Not now". The card may come back later; see lib/push-ask.ts. */
  onDecline: () => void;
  /** Proceed to the system prompt. */
  onAccept: () => void;
}

/**
 * The pre-permission sheet, shown at the first quiet moment after a capture
 * has landed and its pill has gone (or on a later launch, if that moment was
 * missed).
 *
 * The copy is direct: it says "notifications", says what they are for, and
 * asks. An earlier version led with the mechanism's poetry ("want a nudge?")
 * and tested as unclear. It still states the ceiling up front, since the
 * honest answer to "how often will this bother me" is the main thing standing
 * between a person and yes.
 */
export function PushPrimer({ visible, onDecline, onAccept }: Props) {
  const c = useThemeColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2, marginBottom: Spacing[3] }}>
            NOTIFICATIONS
          </Text>

          <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
            turn on notifications and mneme will keep you on track with what
            you're learning: a reminder when your streak needs one capture, and a
            heads-up when two things you saved disagree or a thread picks up.
          </Text>

          <Text variant="serif" style={{ lineHeight: 26, marginTop: Spacing[4], color: c.text }}>
            turn on notifications?
          </Text>

          <Text variant="monoSmall" style={{ color: c.faint, marginTop: Spacing[5], letterSpacing: 1 }}>
            a few a day at most. no badges.
          </Text>

          <View style={styles.actions}>
            <Pressable onPress={onDecline} hitSlop={8} style={styles.action}>
              <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                not now
              </Text>
            </Pressable>
            <Pressable onPress={onAccept} hitSlop={8} style={styles.action}>
              <Text variant="monoSmall" style={{ color: c.text, letterSpacing: 1 }}>
                turn on →
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
