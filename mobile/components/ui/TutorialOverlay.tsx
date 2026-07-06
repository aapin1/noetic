import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { Text } from './Text';
import { Button } from './Button';

export function TutorialOverlay() {
  const { active, stepIndex, step, totalSteps, next, back, stop } = useTutorial();
  const c = useThemeColors();

  if (!active) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  return (
    <Modal visible={active} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2, marginBottom: Spacing[3] }}>
            {step.title.toUpperCase()}
          </Text>
          <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
            {step.body}
          </Text>

          <View style={styles.dotRow}>
            {Array.from({ length: totalSteps }, (_, i) => i).map((i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === stepIndex ? c.text : 'transparent',
                    borderColor: i === stepIndex ? c.text : c.border,
                  },
                ]}
              />
            ))}
          </View>

          <View style={styles.controlRow}>
            <Pressable onPress={stop} hitSlop={12}>
              <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                skip tutorial
              </Text>
            </Pressable>
            <View style={styles.buttonGroup}>
              {!isFirst && (
                <Button
                  label="back"
                  variant="tertiary"
                  size="sm"
                  onPress={back}
                  style={{ marginRight: Spacing[3] }}
                />
              )}
              <Button
                label={isLast ? 'start exploring' : 'next'}
                variant="primary"
                size="sm"
                onPress={isLast ? stop : next}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[16],
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[6],
  },
  dotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing[5],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    marginRight: Spacing[2],
    marginBottom: Spacing[2],
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[5],
  },
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
