import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useTutorial, TutorialRect } from '@/contexts/TutorialContext';
import { Text } from './Text';
import { Button } from './Button';

const { width: SW, height: SH } = Dimensions.get('window');
const TAB_H = Platform.OS === 'ios' ? 86 : 68;
// Height of the icon+label band at the top of a tab button — the part worth
// spotlighting (the rest of the tab-bar height is safe-area padding).
const TAB_HIT_H = 52;
const HOLE_PAD = 8;
const SPOTLIGHT_SCRIM = 'rgba(0,0,0,0.72)';

/**
 * The interactive walkthrough surface. Rendered at the app root as a plain
 * absolute-fill (NOT a RN Modal) so touches can pass through its cutout to the
 * real control beneath, and so it can measure controls anywhere in the tree.
 */
export function TutorialOverlay() {
  const { active, step, stepIndex, totalSteps, targetRects, next, stop } = useTutorial();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active) return null;

  // Resolve the spotlight hole for this step, if any.
  let hole: TutorialRect | null = null;
  if (step.target.kind === 'registered') {
    hole = targetRects[step.target.id] ?? null;
  } else if (step.target.kind === 'tab') {
    const colW = SW / 6;
    hole = { x: step.target.index * colW, y: SH - TAB_H, width: colW, height: TAB_HIT_H };
  }

  const isCard = step.target.kind === 'card';
  const scrimColor = isCard ? `rgba(0,0,0,${step.scrim ?? 0.6})` : SPOTLIGHT_SCRIM;

  // Card sits clear of what it points at. Every spotlight target lives in the
  // lower half (FAB, capture buttons, tabs) → card at top. Card-only steps get
  // pinned to the bottom, keeping the centered map/node visible above.
  const cardAtTop = hole !== null;

  const isLast = stepIndex === totalSteps - 1;
  const cardButtonLabel = isLast ? 'done' : stepIndex === 0 ? 'begin' : 'got it';

  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.35] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  // A circle around the round FAB, rounded rects around wider targets.
  const ringRadius = hole ? Math.min(hole.width, hole.height) / 2 + HOLE_PAD : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {hole ? (
        // Four dim panels framing the hole. The hole itself has no view over
        // it, so taps land on the real control underneath.
        <>
          <View style={[styles.dim, { top: 0, left: 0, right: 0, height: Math.max(0, hole.y - HOLE_PAD), backgroundColor: scrimColor }]} />
          <View style={[styles.dim, { top: hole.y + hole.height + HOLE_PAD, left: 0, right: 0, bottom: 0, backgroundColor: scrimColor }]} />
          <View style={[styles.dim, { top: hole.y - HOLE_PAD, left: 0, width: Math.max(0, hole.x - HOLE_PAD), height: hole.height + HOLE_PAD * 2, backgroundColor: scrimColor }]} />
          <View style={[styles.dim, { top: hole.y - HOLE_PAD, left: hole.x + hole.width + HOLE_PAD, right: 0, height: hole.height + HOLE_PAD * 2, backgroundColor: scrimColor }]} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                left: hole.x - HOLE_PAD,
                top: hole.y - HOLE_PAD,
                width: hole.width + HOLE_PAD * 2,
                height: hole.height + HOLE_PAD * 2,
                borderRadius: ringRadius,
                borderColor: c.text,
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />
        </>
      ) : (
        // Card-only step, or a registered target we haven't measured yet: a
        // full-screen scrim that simply absorbs taps (the screen stays inert).
        <View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]} />
      )}

      <View
        pointerEvents="box-none"
        style={[
          styles.cardWrap,
          cardAtTop
            ? { top: insets.top + Spacing[3] }
            : { bottom: insets.bottom + TAB_H + Spacing[6] },
        ]}
      >
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.cardHead}>
            <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2 }}>
              {step.title.toUpperCase()}
            </Text>
            <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
              {stepIndex + 1} / {totalSteps}
            </Text>
          </View>

          <Text variant="serif" color="secondary" style={styles.body}>
            {step.body}
          </Text>

          <View style={styles.footer}>
            <Pressable onPress={stop} hitSlop={12} accessibilityRole="button" accessibilityLabel="Exit walkthrough">
              <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                exit
              </Text>
            </Pressable>
            {isCard ? (
              <Button label={cardButtonLabel} variant="primary" size="sm" onPress={isLast ? stop : next} />
            ) : (
              <Text variant="monoSmall" style={{ color: c.muted, letterSpacing: 0.5 }}>
                tap the highlighted spot
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: Radius.md,
  },
  cardWrap: {
    position: 'absolute',
    left: Spacing[5],
    right: Spacing[5],
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[4],
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[3],
  },
  body: {
    lineHeight: 24,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[4],
  },
});
