import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from './Text';

interface Props {
  visible: boolean;
  /** Dismissed without asking — we never show this again either way. */
  onDecline: () => void;
  /** Proceed to the system prompt. */
  onAccept: () => void;
}

/**
 * The pre-permission sheet, shown once, after a first capture actually lands.
 *
 * Two rules shape the copy. It promises the thing rather than the mechanism —
 * "when two things you saved disagree", not "enable notifications" — because
 * the system prompt that follows is one-shot per install and a vague ask spends
 * it for nothing. And it states the ceiling up front, since the honest answer to
 * "how often will this bother me" is the main thing standing between a person
 * and yes.
 */
export function PushPrimer({ visible, onDecline, onAccept }: Props) {
  const c = useThemeColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2, marginBottom: Spacing[3] }}>
            SAVED
          </Text>

          <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
            mneme keeps reading after you save. it notices when two things you
            saved disagree, when a thread starts moving, when something you cared
            about has gone quiet.
          </Text>

          <Text variant="serif" color="secondary" style={{ lineHeight: 26, marginTop: Spacing[4] }}>
            we can tell you when that happens. otherwise you'd only find out by
            opening the app and looking.
          </Text>

          <Text variant="monoSmall" style={{ color: c.faint, marginTop: Spacing[5], letterSpacing: 1 }}>
            once a day at most. no badges, no counts.
          </Text>

          <View style={styles.actions}>
            <Pressable onPress={onDecline} hitSlop={8} style={styles.action}>
              <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                not now
              </Text>
            </Pressable>
            <Pressable onPress={onAccept} hitSlop={8} style={styles.action}>
              <Text variant="monoSmall" style={{ color: c.text, letterSpacing: 1 }}>
                tell me →
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
