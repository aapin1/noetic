import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text as RNText, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { GLASS_ACTIVE_BG, GLASS_BG, GLASS_BORDER, GLASS_BORDER_GLOW } from '@/constants/mapPalette';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import type { GuideArt } from '@/lib/guide';

interface Props {
  /** Absolute placement, computed by the host (it owns the insets). */
  frame: ViewStyle;
  /** Which screen edge the pill slides in from. */
  enter?: 'left' | 'right';
  /** The one line, typed out character by character. */
  text: string;
  /** Action label; null renders a text-only pill (✕ still moves on). */
  cta: string | null;
  /** Who's speaking — the cat, the envelope, a ✦, or nobody. */
  art?: GuideArt;
  onCta: () => void;
  onSkip: () => void;
}

// Entrance, then the typing starts — one thing at a time.
const ENTER_MS = 320;
const TYPE_MS_PER_CHAR = 24;

/**
 * The welcome pills' voice: the same glass pill a capture confirmation uses,
 * its line typed out live with a mono cursor. The pill takes a fixed width
 * (an invisible copy of the full text reserves every line it will need), so
 * the text always shows whole — no clipping, no reflow while it types.
 */
export function GuidePill({ frame, enter = 'right', text, cta, art = 'cat', onCta, onSkip }: Props) {
  const { width: screenW } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const slide = useRef(new Animated.Value(0)).current;
  const ctaFade = useRef(new Animated.Value(0)).current;
  const [typedCount, setTypedCount] = useState(0);
  const typed = typedCount >= text.length;

  useEffect(() => {
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // Re-run per beat so each new line arrives the way the first did.
  }, [text, slide]);

  // The typewriter: waits out the entrance, then reveals ~1 character per
  // frame-and-a-half. Reduce Motion (or a re-shown beat) prints instantly.
  useEffect(() => {
    setTypedCount(reduceMotion ? text.length : 0);
    if (reduceMotion) return;
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setTypedCount(i);
        if (i >= text.length && interval) clearInterval(interval);
      }, TYPE_MS_PER_CHAR);
    }, ENTER_MS + 120);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, reduceMotion]);

  // The action arrives once the line has been said, not before.
  useEffect(() => {
    ctaFade.setValue(0);
    if (!typed) return;
    Animated.timing(ctaFade, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [typed, ctaFade]);

  return (
    <Animated.View
      style={[
        styles.pill,
        frame,
        {
          width: Math.min(screenW - Spacing[4] * 2, 320),
          opacity: slide,
          transform: [
            {
              translateX: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [enter === 'left' ? -72 : 72, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.row} pointerEvents="auto">
        {art === 'cat' || art === 'mail' ? (
          <AsciiLoader inline idle={art === 'cat'} variant={art} size={30} color="rgba(240,232,214,0.77)" />
        ) : art === 'spark' ? (
          <RNText style={styles.spark}>✦</RNText>
        ) : null}
        {/* The invisible full line sets the pill's final size up front; the
            typed line paints over it. The text can never be cut off — its
            room is reserved before the first character lands. */}
        <View style={styles.textCol}>
          <RNText style={[styles.text, styles.ghost]}>{text}</RNText>
          <RNText style={[styles.text, StyleSheet.absoluteFill]}>
            {text.slice(0, typedCount)}
            {typed ? '' : '▌'}
          </RNText>
        </View>
        {/* Generous slop everywhere except toward the CTA below — a tap at or
            near the ✕ must always read as "not now", never as the action. */}
        <Pressable
          onPress={onSkip}
          hitSlop={{ top: 16, right: 16, left: 12, bottom: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Not now"
        >
          <RNText style={styles.close}>✕</RNText>
        </Pressable>
      </View>
      {cta ? (
        <Animated.View style={[styles.actions, { opacity: ctaFade }]} pointerEvents="auto">
          <Pressable
            onPress={onCta}
            disabled={!typed}
            // No upward slop: the ✕ sits directly above, and any ambiguity
            // between "dismiss" and "act" must resolve to dismiss.
            hitSlop={{ top: 0, bottom: 8, left: 8, right: 8 }}
            style={styles.ctaBtn}
            accessibilityRole="button"
            accessibilityLabel={cta}
          >
            <RNText style={styles.cta}>{cta}</RNText>
          </Pressable>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    backgroundColor: GLASS_BG,
    borderColor: GLASS_BORDER,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  textCol: {
    flex: 1,
  },
  text: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    lineHeight: FontSize.xs + 6,
    letterSpacing: 0.5,
    color: 'rgba(240,232,214,0.8)',
  },
  ghost: {
    opacity: 0,
  },
  spark: {
    fontFamily: FontFamily.mono,
    fontSize: 15,
    color: 'rgba(240,232,214,0.6)',
    paddingHorizontal: 4,
  },
  close: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: 'rgba(240,232,214,0.49)',
    paddingHorizontal: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // Enough air below the ✕ that the two targets never crowd each other.
    marginTop: Spacing[3],
  },
  ctaBtn: {
    borderWidth: 1,
    borderRadius: Radius.full,
    borderColor: GLASS_BORDER_GLOW,
    backgroundColor: GLASS_ACTIVE_BG,
    paddingVertical: 5,
    paddingHorizontal: Spacing[3],
  },
  cta: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    letterSpacing: 0.5,
    color: 'rgba(240,232,214,0.84)',
  },
});
