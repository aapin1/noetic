import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { XIcon } from 'lucide-react-native';
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

/**
 * A mount fade on the core Animated API, used wherever Mind used to lean on
 * Reanimated's `entering` layout animations. Those ran on the UI thread
 * through a snapshot of the subtree, and on the new architecture a
 * ScrollView mounted inside one would sometimes keep missing touches after
 * the snapshot went away, and the page under it ghosted through. A plain
 * opacity and translate on the real view has neither problem.
 */
export function FadeInView({
  children,
  style,
  duration = 220,
  rise = 0,
  delay = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  /** Start this many points lower and settle up, for a body sliding in. */
  rise?: number;
  delay?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(rise)).current;
  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration, delay, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [opacity, translateY, duration, delay]);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

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
    <FadeInView style={[StyleSheet.absoluteFill, { backgroundColor: background }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={16}
            style={styles.close}
            accessibilityLabel="Close detail view"
            accessibilityRole="button"
          >
            <XIcon size={22} color={ink(0.7)} />
          </Pressable>
          <View style={styles.headLeft}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text variant="headline" style={{ color: ink(0.92) }}>
              {typeLabel}
            </Text>
          </View>
        </View>
        <FadeInView style={styles.body} duration={340} delay={60} rise={14}>
          {children}
        </FadeInView>
      </SafeAreaView>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[1],
    // Above the body: a stage label that overflows its stage must never
    // land on top of the close button.
    zIndex: 2,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -Spacing[3],
  },
  headLeft: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: Spacing[2] },
  body: { flex: 1 },
});
