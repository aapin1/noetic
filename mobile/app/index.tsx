import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'expo-router';
import { FontFamily, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Brain } from '@/components/Brain';

const { width: SCREEN_W } = Dimensions.get('window');
const BRAIN_SIZE = Math.min(SCREEN_W * 0.72, 300);

const TAGLINE = '> save. connect. remember.';
const TYPE_MS = 55;

/** Types the tagline out one character at a time, then blinks a cursor. */
function TypedTagline({ color }: { color: string }) {
  const [chars, setChars] = useState(0);
  const cursor = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setInterval(() => {
      setChars((n) => {
        if (n >= TAGLINE.length) { clearInterval(t); return n; }
        return n + 1;
      });
    }, TYPE_MS);
    return () => clearInterval(t);
  }, []);

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

  // Gentle idle motion: the brain breathes and sways like it's thinking.
  const breath = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  // Staggered entrance for the content blocks.
  const enterBrain = useRef(new Animated.Value(0)).current;
  const enterCopy = useRef(new Animated.Value(0)).current;
  const enterCta = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const swing = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 3800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 3800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const entrance = Animated.stagger(160, [
      Animated.timing(enterBrain, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(enterCopy, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(enterCta, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    breathe.start();
    swing.start();
    entrance.start();
    return () => { breathe.stop(); swing.stop(); entrance.stop(); };
  }, [breath, sway, enterBrain, enterCopy, enterCta]);

  if (!isLoading && isAuthenticated && hasProfile) {
    return <Redirect href="/(tabs)" />;
  }
  if (!isLoading && isAuthenticated && !hasProfile) {
    return <Redirect href="/(onboarding)/topics" />;
  }

  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.03] });
  const swayRotate = sway.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  const rise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <Text variant="wordmark" style={styles.mark}>
          mneme
        </Text>
        <Animated.View style={[styles.brain, rise(enterBrain)]}>
          <Animated.View style={{ transform: [{ scale: breathScale }, { rotate: swayRotate }] }}>
            <Brain size={BRAIN_SIZE} density={72} intensity={0.85} />
          </Animated.View>
          <TypedTagline color={c.muted} />
        </Animated.View>
        <Animated.View style={rise(enterCopy)}>
          <Text variant="h1" style={styles.line}>
            Save what catches your eye.
          </Text>
          <Text variant="serif" color="secondary" style={styles.sub}>
            Mneme connects what you save and shows you what you keep coming back to.
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  sub: { textAlign: 'center', marginTop: Spacing[4], maxWidth: 340, alignSelf: 'center' },
  cta: { marginTop: Spacing[10] },
  secondary: { marginTop: Spacing[6], alignSelf: 'center', padding: Spacing[2] },
});
