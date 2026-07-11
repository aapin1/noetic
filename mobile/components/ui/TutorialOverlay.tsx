import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, Radius } from '@/constants/theme';
import type { AppThemeColors } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useTutorial, TutorialRect } from '@/contexts/TutorialContext';
import { TAB_COUNT } from '@/constants/tutorialSteps';
import { Text } from './Text';
import { Button } from './Button';

const { width: SW, height: SH } = Dimensions.get('window');
const TAB_H = Platform.OS === 'ios' ? 86 : 68;
// The icon band inside a tab button: the bar has 14px of top padding before
// the icon, so the spotlight starts below the bar's top edge and only spans
// the icon itself (the rest of the bar height is safe-area padding).
const TAB_HIT_Y = 10;
const TAB_HIT_H = 42;
const HOLE_PAD = 8;
const HOLE_RADIUS = 14;
// One darkness level, used on every step (hole or card) so nothing flickers
// between slides — only the focus point moves.
const AMBIENT_DIM = 0.55;
// How long a freshly-opened step sits dimmed, with no card, before it fades
// in — gives the user a beat to look at the real screen first. Also hides the
// card re-anchoring that happens when a target's rect is measured late.
const CARD_REVEAL_DELAY = 800;
const CARD_FADE_MS = 420;
// Rough worst-case card height (visual step included), used only to decide
// which side of the spotlight the card fits on — never to size the card.
const CARD_EST_H = 250;
// Walkthrough accent — matches the map's discovery/multi-select green so the
// tutorial reads as part of the atlas rather than a bolt-on.
const ACCENT = '#7EC8A0';

/** Mock OS share-sheet, shown on the share step: the app row with mneme lit. */
function ShareVisual({ c }: { c: AppThemeColors }) {
  return (
    <View style={[sv.box, { borderColor: c.borderSubtle, backgroundColor: c.elevated }]}>
      <View style={[sv.urlPill, { borderColor: c.borderSubtle }]}>
        <Text variant="monoSmall" numberOfLines={1} style={{ color: c.muted, flex: 1 }}>
          an-article-you-loved.com
        </Text>
        <Text variant="monoSmall" style={{ color: c.faint }}>share ↑</Text>
      </View>
      <View style={sv.appRow}>
        {['msgs', 'mail', 'notes'].map((name) => (
          <View key={name} style={sv.app}>
            <View style={[sv.appCircle, { backgroundColor: c.border }]} />
            <Text variant="monoSmall" style={[sv.appLabel, { color: c.faint }]}>{name}</Text>
          </View>
        ))}
        <View style={sv.app}>
          <View style={[sv.appCircle, sv.appCircleAccent]}>
            <Text variant="monoSmall" style={{ color: ACCENT }}>m</Text>
          </View>
          <Text variant="monoSmall" style={[sv.appLabel, { color: ACCENT }]}>mneme</Text>
        </View>
      </View>
    </View>
  );
}

const sv = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing[3],
    marginBottom: Spacing[3],
  },
  urlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    marginBottom: Spacing[3],
  },
  appRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  app: { alignItems: 'center', gap: 4 },
  appCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appCircleAccent: {
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: 'rgba(126,200,160,0.12)',
  },
  appLabel: { fontSize: 9 },
});

/**
 * The interactive walkthrough surface. Rendered at the app root as a plain
 * absolute-fill (NOT a RN Modal) so touches can pass through its cutout to the
 * real control beneath, and so it can measure controls anywhere in the tree.
 */
export function TutorialOverlay() {
  const { active, step, stepIndex, totalSteps, targetRects, next, stop } = useTutorial();
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
    const colW = SW / TAB_COUNT;
    hole = { x: step.target.index * colW, y: SH - TAB_H + TAB_HIT_Y, width: colW, height: TAB_HIT_H };
  }

  const isCard = step.target.kind === 'card';
  // Registered/tab steps normally only advance by the user touching the real
  // control; "look at this" steps also offer the card's own button so the
  // walkthrough can't strand someone on a target that never resolves.
  const showCardButton = isCard || !!step.dismissible;

  const isLast = stepIndex === totalSteps - 1;
  const cardButtonLabel = isLast ? 'done' : stepIndex === 0 ? 'begin' : 'got it';

  // Place the card adjacent to the spotlight, in whichever gap actually fits
  // it — so it can never sit on top of the control it's pointing at. Cards
  // with no target sit above the tab bar; if neither gap fits (a hole that
  // fills most of the screen), pin to the top, away from bottom-anchored
  // actions like the capture form's buttons.
  let cardAnchor: { top?: number; bottom?: number };
  if (!hole) {
    cardAnchor = { bottom: insets.bottom + TAB_H + Spacing[6] };
  } else {
    const holeTop = hole.y - HOLE_PAD;
    const holeBottom = hole.y + hole.height + HOLE_PAD;
    const gapAbove = holeTop - insets.top;
    const gapBelow = SH - insets.bottom - holeBottom;
    const fitsAbove = gapAbove >= CARD_EST_H;
    const fitsBelow = gapBelow >= CARD_EST_H;
    if (fitsAbove && (gapAbove >= gapBelow || !fitsBelow)) {
      cardAnchor = { bottom: SH - holeTop + Spacing[3] };
    } else if (fitsBelow) {
      cardAnchor = { top: holeBottom + Spacing[3] };
    } else {
      cardAnchor = { top: insets.top + Spacing[3] };
    }
  }

  const holeX = hole ? hole.x - HOLE_PAD : 0;
  const holeY = hole ? hole.y - HOLE_PAD : 0;
  const holeW = hole ? hole.width + HOLE_PAD * 2 : 0;
  const holeH = hole ? hole.height + HOLE_PAD * 2 : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {hole ? (
          // A crisp rounded-rect cutout that hugs the measured target — reads
          // as a deliberate frame at any target size and any screen size,
          // where a radial glow around a large region just looked like half
          // the screen was lit for no reason.
          <Svg width={SW} height={SH}>
            <Defs>
              <Mask id="tutorialHole" x={0} y={0} width={SW} height={SH} maskUnits="userSpaceOnUse">
                <Rect x={0} y={0} width={SW} height={SH} fill="#fff" />
                <Rect x={holeX} y={holeY} width={holeW} height={holeH} rx={HOLE_RADIUS} fill="#000" />
              </Mask>
            </Defs>
            <Rect x={0} y={0} width={SW} height={SH} fill="#000" fillOpacity={AMBIENT_DIM} mask="url(#tutorialHole)" />
            <Rect
              x={holeX} y={holeY} width={holeW} height={holeH} rx={HOLE_RADIUS}
              fill="none" stroke={ACCENT} strokeOpacity={0.6} strokeWidth={1.5}
            />
          </Svg>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: AMBIENT_DIM }]} />
        )}
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

      <View pointerEvents="box-none" style={[styles.cardWrap, cardAnchor]}>
        <Animated.View style={{ opacity: cardOpacity, width: '100%', alignItems: 'flex-end' }}>
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
              {/* Progress: a thin accent track — quicker to read than "7/20". */}
              <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
                <View style={[styles.progressFill, { width: `${((stepIndex + 1) / totalSteps) * 100}%` }]} />
              </View>

              <View style={styles.cardHead}>
                <Text variant="monoSmall" style={{ color: ACCENT, letterSpacing: 1 }}>
                  {String(stepIndex + 1).padStart(2, '0')}
                </Text>
                <Text variant="monoSmall" style={[styles.cardTitle, { color: c.faint }]} numberOfLines={1}>
                  {step.title.toUpperCase()}
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

              {step.visual === 'share' && <ShareVisual c={c} />}

              <Text variant="serif" color="secondary" style={styles.body}>
                {step.body}
              </Text>

              <View style={styles.footer}>
                <Pressable onPress={stop} hitSlop={12} accessibilityRole="button" accessibilityLabel="Exit walkthrough">
                  <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                    exit
                  </Text>
                </Pressable>
                {showCardButton ? (
                  <Button label={cardButtonLabel} variant="primary" size="sm" onPress={isLast ? stop : next} />
                ) : (
                  <Text variant="monoSmall" style={{ color: ACCENT, letterSpacing: 0.5 }}>
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
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
  },
  collapsedTab: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
  },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
    marginBottom: Spacing[4],
  },
  progressFill: {
    height: 2,
    borderRadius: 1,
    backgroundColor: ACCENT,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing[3],
  },
  cardTitle: {
    flex: 1,
    letterSpacing: 2,
    marginLeft: Spacing[3],
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
