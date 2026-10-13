import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Button } from './Button';
import { Text } from './Text';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  body: string;
  /** Optional single action rendered above the Done button. */
  action?: { label: string; onPress: () => void };
}

/**
 * A short explanatory sheet: grabber, a sentence-case title, body copy, and a
 * Done button. Dismisses on the scrim, the button, or the hardware back.
 */
export function InfoModal({ visible, onClose, title, body, action }: Props) {
  const c = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <Text variant="h4" style={styles.title}>{title}</Text>
          <Text variant="body" color="secondary">{body}</Text>
          <View style={styles.actions}>
            {action ? (
              <Button label={action.label} variant="secondary" size="md" fullWidth onPress={action.onPress} />
            ) : null}
            <Button label="Done" variant="primary" size="md" fullWidth onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,9,7,0.5)',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[10],
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius['2xl'],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[6],
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    marginBottom: Spacing[5],
  },
  title: { marginBottom: Spacing[2] },
  actions: { marginTop: Spacing[6], gap: Spacing[3] },
});
