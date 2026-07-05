import React from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'expo-router';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Brain } from '@/components/Brain';

const { width: SCREEN_W } = Dimensions.get('window');
const BRAIN_SIZE = Math.min(SCREEN_W * 0.76, 320);

export default function LandingScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { isAuthenticated, hasProfile, isLoading } = useAuth();

  if (!isLoading && isAuthenticated && hasProfile) {
    return <Redirect href="/(tabs)" />;
  }
  if (!isLoading && isAuthenticated && !hasProfile) {
    return <Redirect href="/(onboarding)/topics" />;
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <Text variant="wordmark" style={styles.mark}>
          mneme
        </Text>
        <View style={styles.brain}>
          <Brain size={BRAIN_SIZE} density={72} intensity={0.85} />
        </View>
        <Text variant="h1" style={styles.line}>
          Save what catches your eye.
        </Text>
        <Text variant="serif" color="secondary" style={styles.sub}>
          Mneme connects what you save and shows you what you keep coming back to.
        </Text>
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
  line: { textAlign: 'center' },
  sub: { textAlign: 'center', marginTop: Spacing[4], maxWidth: 340, alignSelf: 'center' },
  cta: { marginTop: Spacing[10] },
  secondary: { marginTop: Spacing[6], alignSelf: 'center', padding: Spacing[2] },
});
