import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from './Text';
import { Button } from './Button';

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
          <Text variant="headline" style={{ marginBottom: Spacing[3] }}>
            Turn on notifications
          </Text>

          <Text variant="body" color="secondary">
            Mneme will keep you on track with what you&apos;re learning: a reminder
            when your streak needs one capture, and a heads-up when two things you
            saved disagree or a thread picks up.
          </Text>

          <Text variant="caption" color="muted" style={{ marginTop: Spacing[4] }}>
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
    alignItems: 'center',
    gap: Spacing[3],
    marginTop: Spacing[6],
  },
});
