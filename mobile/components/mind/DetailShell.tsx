import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

// Full-screen stage for a Mind detail visualization. Mind sits on the app
// theme like the list tabs — paper in light mode, ink in dark — so it reads
// as one app with memory/pulse/you rather than as a second Atlas. Only the
// Atlas keeps the always-dark map surface.
//
// Ink for anything drawn on the stage: the theme's warm text family, taken at
// the same opacity ramps the dark stage used. A hook rather than a constant
// because the base flips with the scheme.
export function useStageInk(): (o: number) => string {
  const { scheme } = useTheme();
  // Matches text: #EFEADE on ink, #241F18 on paper.
  return scheme === 'dark'
    ? (o: number) => `rgba(239,234,222,${o})`
    : (o: number) => `rgba(36,31,24,${o})`;
}

// A detail view opens *inside* the Mind tab, so the tab bar floats over the
// bottom of its page. Every scrolling detail view has to end above the bar —
// at the old 48pt the closing CTAs sat underneath it with no scroll left to
// bring them out, which read as the page refusing to scroll. Keep in step
// with the tab bar height in (tabs)/_layout.tsx.
export const DETAIL_PAGE_BOTTOM = Platform.OS === 'ios' ? 98 : 82;

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
  const ink = useStageInk();
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      style={[StyleSheet.absoluteFill, { backgroundColor: background }]}
    >
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close detail view">
            <Text variant="monoSmall" style={{ color: ink(0.55) }}>close</Text>
          </Pressable>
          <View style={styles.headLeft}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text variant="monoSmall" style={{ color: accent, letterSpacing: 2 }}>
              {typeLabel}
            </Text>
          </View>
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
