import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';

// Full-screen stage for a Mind detail visualization. Mind's canvas is dark in
// both themes (Atlas convention), so the shell is too — on-stage text is light.
export const stageInk = (o: number) => `rgba(236,236,236,${o})`;

export function DetailShell({
  typeLabel,
  accent,
  background,
  onClose,
  children,
}: {
  typeLabel: string;
  accent: string;
  background: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      style={[StyleSheet.absoluteFill, { backgroundColor: background }]}
    >
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.headLeft}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text variant="monoSmall" style={{ color: accent, letterSpacing: 2 }}>
              {typeLabel}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close detail view">
            <Text variant="monoSmall" style={{ color: stageInk(0.55) }}>close</Text>
          </Pressable>
        </View>
        <Animated.View entering={FadeInDown.duration(340).delay(60)} style={styles.body}>
          {children}
        </Animated.View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
  },
  headLeft: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: Spacing[2] },
  body: { flex: 1 },
});
