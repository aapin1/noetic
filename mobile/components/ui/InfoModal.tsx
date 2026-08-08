import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from './Text';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  body: string;
  /** Optional single action rendered above "tap to close". */
  action?: { label: string; onPress: () => void };
}

export function InfoModal({ visible, onClose, title, body, action }: Props) {
  const c = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2, marginBottom: Spacing[3] }}>
            {title.toUpperCase()}
          </Text>
          <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
            {body}
          </Text>
          {action ? (
            <Pressable
              onPress={action.onPress}
              accessibilityRole="button"
              style={[styles.action, { borderTopColor: c.border }]}
            >
              <Text variant="monoSmall" style={{ color: c.text, letterSpacing: 1 }}>
                {action.label}
              </Text>
            </Pressable>
          ) : null}
          <Text variant="monoSmall" style={{ color: c.faint, marginTop: Spacing[5], textAlign: 'center', letterSpacing: 1 }}>
            tap to close
          </Text>
        </View>
      </Pressable>
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
  action: {
    marginTop: Spacing[5],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
    alignItems: 'center',
  },
});
