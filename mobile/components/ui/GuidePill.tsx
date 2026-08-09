import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { GLASS_ACTIVE_BG, GLASS_BG, GLASS_BORDER, GLASS_BORDER_GLOW } from '@/constants/mapPalette';
import { AsciiLoader } from '@/components/ui/AsciiLoader';

interface Props {
  /** Distance from the top of the screen (host passes insets.top + offset). */
  top: number;
  /** The one line. */
  text: string;
  /** Action label; null renders a text-only pill (✕ still moves on). */
  cta: string | null;
  onCta: () => void;
  onSkip: () => void;
}

/**
 * The guide's voice: the same glass pill a capture confirmation uses, sliding
 * in from the right edge with the ascii cat — familiar, top-of-screen, and
 * never in the way of the map. One line, at most one action, always a ✕.
 */
export function GuidePill({ top, text, cta, onCta, onSkip }: Props) {
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // Re-run per step so each new lesson arrives the way the first did.
  }, [text, slide]);

  return (
    <Animated.View
      style={[
        styles.pill,
        {
          top,
          opacity: slide,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [72, 0] }) }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.row} pointerEvents="auto">
        <AsciiLoader inline idle variant="cat" size={30} color="rgba(240,232,214,0.77)" />
        <Animated.Text style={styles.text}>{text}</Animated.Text>
        <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" accessibilityLabel="Not now">
          <Animated.Text style={styles.close}>✕</Animated.Text>
        </Pressable>
      </View>
      {cta ? (
        <View style={styles.actions} pointerEvents="auto">
          <Pressable
            onPress={onCta}
            hitSlop={8}
            style={styles.ctaBtn}
            accessibilityRole="button"
            accessibilityLabel={cta}
          >
            <Animated.Text style={styles.cta}>{cta}</Animated.Text>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: Spacing[4],
    maxWidth: 300,
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
  text: {
    flex: 1,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    letterSpacing: 0.5,
    color: 'rgba(240,232,214,0.8)',
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
    marginTop: Spacing[2],
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
