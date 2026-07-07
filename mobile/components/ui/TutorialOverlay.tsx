import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
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
// One darkness level, used on every step (hole or card) so nothing flickers
// between slides — only the focus point moves.
const AMBIENT_DIM = 0.55;
// How long a freshly-opened step sits dimmed, with no card, before it fades
// in — gives the user a beat to look at the real screen first.
const CARD_REVEAL_DELAY = 1000;
const CARD_FADE_MS = 420;

/**
 * The interactive walkthrough surface. Rendered at the app root as a plain
 * absolute-fill (NOT a RN Modal) so touches can pass through its cutout to the
 * real control beneath, and so it can measure controls anywhere in the tree.
 */
export function TutorialOverlay() {
  const { active, step, stepIndex, totalSteps, targetRects, next, stop, note } = useTutorial();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const [collapsed, setCollapsed] = useState(false);
  const cardOpacity = useRef(new Animated.Value(0)).current;

  // Let the dimmed screen sit alone for a moment before the card slides in —
  // abrupt cards covering a chunk of an unfamiliar screen feel jarring.
  useEffect(() => {
    if (!active) return;
    setCollapsed(false);
    cardOpacity.setValue(0);
    const t = setTimeout(() => {
      Animated.timing(cardOpacity, { toValue: 1, duration: CARD_FADE_MS, useNativeDriver: true }).start();
    }, CARD_REVEAL_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step.id]);

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
  // Card sits clear of what it points at. Every spotlight target lives in the
  // lower half (FAB, capture form, tabs) → card at top. Card-only steps get
  // pinned to the bottom, keeping the centered map/node visible above.
  const cardAtTop = hole !== null;

  const isLast = stepIndex === totalSteps - 1;
  const cardButtonLabel = isLast ? 'done' : stepIndex === 0 ? 'begin' : 'got it';
  const body = note ?? step.body;

  // A soft, off-center glow rather than a hard-edged cutout: fully normal at
  // the focus point, gradually darkening outward to the same ambient level
  // everywhere, on every step.
  const holeSpan = hole ? Math.max(hole.width, hole.height) : 0;
  const focusX = hole ? hole.x + hole.width / 2 : SW / 2;
  const focusY = hole ? hole.y + hole.height / 2 : SH * 0.42;
  const innerR = hole ? holeSpan / 2 + 18 : SW * 0.22;
  const outerR = hole ? holeSpan / 2 + 150 : SW * 0.62;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width={SW} height={SH}>
          <Defs>
            <RadialGradient id="tutorialDim" cx={focusX} cy={focusY} r={outerR} gradientUnits="userSpaceOnUse">
              <Stop offset={0} stopColor="#000" stopOpacity={0} />
              <Stop offset={Math.min(0.98, innerR / outerR)} stopColor="#000" stopOpacity={0} />
              <Stop offset={1} stopColor="#000" stopOpacity={AMBIENT_DIM} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={SW} height={SH} fill="url(#tutorialDim)" />
        </Svg>
      </View>

      {hole ? (
        // Four invisible panels framing the hole absorb stray taps. The hole
        // itself has no view over it, so taps land on the real control(s)
        // beneath it — the visual dimming above already lights that area.
        <>
          <View pointerEvents="auto" style={[styles.absorb, { top: 0, left: 0, right: 0, height: Math.max(0, hole.y - HOLE_PAD) }]} />
          <View pointerEvents="auto" style={[styles.absorb, { top: hole.y + hole.height + HOLE_PAD, left: 0, right: 0, bottom: 0 }]} />
          <View pointerEvents="auto" style={[styles.absorb, { top: hole.y - HOLE_PAD, left: 0, width: Math.max(0, hole.x - HOLE_PAD), height: hole.height + HOLE_PAD * 2 }]} />
          <View pointerEvents="auto" style={[styles.absorb, { top: hole.y - HOLE_PAD, left: hole.x + hole.width + HOLE_PAD, right: 0, height: hole.height + HOLE_PAD * 2 }]} />
        </>
      ) : (
        // Card-only step, or a registered target we haven't measured yet: a
        // full-screen absorber that simply keeps the screen inert.
        <View pointerEvents="auto" style={StyleSheet.absoluteFill} />
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
        <Animated.View style={{ opacity: cardOpacity }}>
          {collapsed ? (
            <Pressable
              onPress={() => setCollapsed(false)}
              accessibilityRole="button"
              accessibilityLabel="Reopen walkthrough card"
              style={[styles.collapsedTab, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <Text variant="monoSmall" style={{ color: c.muted }}>{'‹'}</Text>
            </Pressable>
          ) : (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.cardHead}>
                <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2 }}>
                  {step.title.toUpperCase()}
                </Text>
                <View style={styles.cardHeadRight}>
                  <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                    {stepIndex + 1} / {totalSteps}
                  </Text>
                  <Pressable
                    onPress={() => setCollapsed(true)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Collapse walkthrough card"
                  >
                    <Text variant="monoSmall" style={{ color: c.faint }}>{'›'}</Text>
                  </Pressable>
                </View>
              </View>

              <Text variant="serif" color="secondary" style={styles.body}>
                {body}
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
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  absorb: {
    position: 'absolute',
  },
  cardWrap: {
    position: 'absolute',
    left: Spacing[5],
    right: Spacing[5],
    alignItems: 'flex-end',
  },
  card: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[4],
  },
  collapsedTab: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[3],
  },
  cardHeadRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
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
