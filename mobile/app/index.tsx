import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'expo-router';
import { FontFamily, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Brain } from '@/components/Brain';
import { HazeField } from '@/components/landing/HazeField';
import { MusesIntro } from '@/components/landing/MusesIntro';

const { width: SCREEN_W } = Dimensions.get('window');
const BRAIN_SIZE = Math.min(SCREEN_W * 0.8, 340);

const TAGLINE = '> save. connect. remember.';
const TYPE_MS = 55;

/** Once the intro has handed off, the haze drops back so it never competes with the CTA. */
const HAZE_SETTLED = 0.6;

/** Types the tagline out one character at a time, then blinks a cursor. */
function TypedTagline({ color, start }: { color: string; start: boolean }) {
  const [chars, setChars] = useState(0);
  const cursor = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!start) return;
    const t = setInterval(() => {
      setChars((n) => {
        if (n >= TAGLINE.length) { clearInterval(t); return n; }
        return n + 1;
      });
    }, TYPE_MS);
    return () => clearInterval(t);
  }, [start]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursor, { toValue: 0, duration: 90, delay: 420, useNativeDriver: true }),
        Animated.timing(cursor, { toValue: 1, duration: 90, delay: 420, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [cursor]);

  return (
    <View style={styles.taglineRow}>
      <Text variant="monoSmall" style={{ color, letterSpacing: 1 }}>
        {TAGLINE.slice(0, chars)}
      </Text>
      <Animated.Text style={{ fontFamily: FontFamily.mono, fontSize: 12, color, opacity: cursor }}>
        _
      </Animated.Text>
    </View>
  );
}

export default function LandingScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { isAuthenticated, hasProfile, isLoading } = useAuth();

  // The muses intro runs first and hands off to this screen. `contentIn` starts
  // the entrance just before the word lands; `introDone` retires the intro and
  // reveals the real wordmark underneath it.
  const [contentIn, setContentIn] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Measured rather than assumed, so the intro's word has something exact to
  // travel to. Both are laid out by the same parent, so the boxes subtract.
  const [markBox, setMarkBox] = useState<{ x: number; y: number } | null>(null);

  // Gentle idle motion: the brain breathes and sways like it's thinking.
  const breath = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  // Staggered entrance for the content blocks.
  const enterBrain = useRef(new Animated.Value(0)).current;
  const enterCopy = useRef(new Animated.Value(0)).current;
  const enterCta = useRef(new Animated.Value(0)).current;

  // A four-second full-screen motion piece is exactly what this setting is for.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (!alive || !on) return;
      setReduceMotion(true);
      setContentIn(true);
      setIntroDone(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const swing = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    breathe.start();
    swing.start();
    return () => { breathe.stop(); swing.stop(); };
  }, [breath, sway, reduceMotion]);

  useEffect(() => {
    if (!contentIn) return;
    if (reduceMotion) {
      enterBrain.setValue(1);
      enterCopy.setValue(1);
      enterCta.setValue(1);
      return;
    }
    const entrance = Animated.stagger(160, [
      Animated.timing(enterBrain, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(enterCopy, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(enterCta, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [contentIn, reduceMotion, enterBrain, enterCopy, enterCta]);

  if (!isLoading && isAuthenticated && hasProfile) {
    return <Redirect href="/(tabs)" />;
  }
  if (!isLoading && isAuthenticated && !hasProfile) {
    return <Redirect href="/(onboarding)/identity" />;
  }

  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.03] });
  const swayRotate = sway.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  const rise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  });

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <HazeField opacity={introDone ? HAZE_SETTLED : 1} reduceMotion={reduceMotion} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.inner}>
          <Text
            variant="wordmark"
            style={[styles.mark, { opacity: introDone ? 1 : 0 }]}
            onLayout={(e) => {
              const { x, y } = e.nativeEvent.layout;
              setMarkBox((prev) => prev ?? { x, y });
            }}
          >
            mneme
          </Text>
          <Animated.View style={[styles.brain, rise(enterBrain)]}>
            <Animated.View style={{ transform: [{ scale: breathScale }, { rotate: swayRotate }] }}>
              <Brain size={BRAIN_SIZE} density={72} intensity={0.85} />
            </Animated.View>
            <TypedTagline color={c.muted} start={contentIn} />
          </Animated.View>
          <Animated.View style={rise(enterCopy)}>
            <Text variant="h1" style={styles.line}>
              Turn what catches your eye into a map of your mind.
            </Text>
          </Animated.View>
          <Animated.View style={rise(enterCta)}>
            <Button
              label="Get started"
              variant="primary"
              size="lg"
              fullWidth
              onPress={() => router.push('/(auth)/sign-up')}
              style={styles.cta}
            />
            <Pressable onPress={() => router.push('/(auth)/sign-in')} style={styles.secondary}>
              <Text variant="monoSmall" color="muted">
                Sign in
              </Text>
            </Pressable>
          </Animated.View>

          {!introDone && markBox && (
            <MusesIntro
              target={markBox}
              onHandoff={() => setContentIn(true)}
              onDone={() => setIntroDone(true)}
            />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    justifyContent: 'center',
  },
  mark: {
    position: 'absolute',
    top: Spacing[8],
    left: Spacing[6],
  },
  brain: { alignItems: 'center', marginBottom: Spacing[8] },
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing[4],
  },
  line: { textAlign: 'center' },
  cta: { marginTop: Spacing[10] },
  secondary: { marginTop: Spacing[6], alignSelf: 'center', padding: Spacing[2] },
});
