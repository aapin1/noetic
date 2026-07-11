import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text as RNText, View } from 'react-native';
import { FontFamily, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Brain } from '@/components/Brain';

type Variant = 'brain' | 'cat';

interface Props {
  /** Loader art size in px. */
  size?: number;
  /** One caption, or several to cycle through while waiting. */
  message?: string | string[];
  variant?: Variant;
  /** Overrides theme colors — e.g. a light tint on the always-dark map. */
  color?: string;
  /** Fills the parent and centers itself. */
  fill?: boolean;
  /**
   * Decorative mode for empty states: same art, calmer cadence, and no
   * "loading" semantics — the pet is just keeping the empty screen company.
   */
  idle?: boolean;
}

// The cat mostly sits there, occasionally blinks, and once in a while winks —
// weighted frames make the idle feel alive instead of metronomic.
const CAT_FRAMES = [
  ' /\\_/\\\n( o.o )\n > ^ <',
  ' /\\_/\\\n( o.o )\n > ^ <',
  ' /\\_/\\\n( o.o )\n > ^ <',
  ' /\\_/\\\n( -.- )\n > ^ <',
  ' /\\_/\\\n( o.o )\n > ^ <',
  ' /\\_/\\\n( o.o )\n > ^ <',
  ' /\\_/\\\n( o.- )\n > ^ <',
  ' /\\_/\\\n( -.- )\n > ^ <',
];

const MESSAGE_INTERVAL_MS = 2000;
const CAT_FRAME_MS = 420;
const SPIN_MS = 6500;
// Enough revolutions to outlast any real loading state. One long timing
// instead of Animated.loop: the loop restarts each iteration through a JS
// round-trip, which could hitch and visibly jump the rotation at the end of
// every cycle.
const SPIN_TURNS = 10000;

/**
 * The app's quirky "working on it" screen: a slowly rotating ASCII brain (or a
 * blinking ASCII cat) with an optional cycling caption. Use for any first-load
 * or long-running state instead of a bare spinner.
 */
export function AsciiLoader({ size = 96, message, variant = 'brain', color, fill, idle }: Props) {
  const c = useThemeColors();
  const tint = color ?? c.muted;

  // Continuous rotation — the brain turning "round and round". Idle brains
  // don't spin (nothing is happening); they just breathe.
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (variant !== 'brain' || idle) return;
    const anim = Animated.timing(spin, {
      toValue: SPIN_TURNS,
      duration: SPIN_MS * SPIN_TURNS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [spin, variant, idle]);
  // Extrapolates past [0,1], so one turn per SPIN_MS with no loop boundary.
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // A gentle breathing pulse layered on the spin so it reads as alive.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });

  // Cat blink frames — idle cats blink at a lazier pace.
  const [catFrame, setCatFrame] = useState(0);
  useEffect(() => {
    if (variant !== 'cat') return;
    const interval = idle ? CAT_FRAME_MS * 2 : CAT_FRAME_MS;
    const t = setInterval(() => setCatFrame((f) => (f + 1) % CAT_FRAMES.length), interval);
    return () => clearInterval(t);
  }, [variant, idle]);

  // Cycling caption with a soft crossfade.
  const messages = useMemo(
    () => (Array.isArray(message) ? message : message ? [message] : []),
    [message],
  );
  const [msgIndex, setMsgIndex] = useState(0);
  const msgOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (messages.length < 2) return;
    const t = setInterval(() => {
      Animated.timing(msgOpacity, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => {
        setMsgIndex((i) => (i + 1) % messages.length);
        Animated.timing(msgOpacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
      });
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [messages, msgOpacity]);

  return (
    <View
      style={[styles.wrap, fill && styles.fill]}
      accessibilityLabel={idle ? undefined : 'Loading'}
      accessibilityRole={idle ? undefined : 'progressbar'}
      pointerEvents="none"
    >
      {variant === 'brain' ? (
        <Animated.View style={{ transform: [{ rotate }, { scale: pulseScale }] }}>
          <Brain size={size} color={color} />
        </Animated.View>
      ) : (
        <Animated.View style={{ transform: [{ scale: pulseScale }] }}>
          <RNText
            style={{
              fontFamily: FontFamily.mono,
              fontSize: size / 5,
              lineHeight: size / 4,
              color: tint,
              textAlign: 'center',
            }}
          >
            {CAT_FRAMES[catFrame]}
          </RNText>
        </Animated.View>
      )}
      {messages.length > 0 && (
        <Animated.Text
          style={[
            styles.caption,
            { color: tint, opacity: messages.length > 1 ? msgOpacity : 0.75 },
          ]}
          numberOfLines={1}
        >
          {messages[msgIndex]}
        </Animated.Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[8],
  },
  fill: {
    flex: 1,
  },
  caption: {
    marginTop: Spacing[5],
    fontFamily: FontFamily.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'lowercase',
  },
});
