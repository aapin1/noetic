import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { track } from '@/lib/analytics';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

export default function WalkthroughOfferScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { start: startTutorial } = useTutorial();

  const enter = (withWalkthrough: boolean) => {
    // "Explore on my own" is a skip of the walkthrough, not of onboarding —
    // both branches reach the app, and the distinction is the thing worth
    // measuring here.
    track('onboarding_step', {
      step: 'walkthrough',
      action: withWalkthrough ? 'completed' : 'skipped',
    });
    if (withWalkthrough) {
      router.replace('/(tabs)');
      startTutorial();
    } else {
      // Self-guided users still get pointed at the one action that matters:
      // the map opens with the capture sheet up, prompting a first save.
      router.replace({ pathname: '/(tabs)', params: { firstCapture: '1' } } as never);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.copy}>
          <Text variant="label" color="muted">
            You're in
          </Text>
          <Text variant="h2">
            Want a quick walkthrough?
          </Text>
          <Text variant="body" color="secondary" style={styles.lead}>
            About a minute. I'll help you save your first thing and show you
            around the map.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            label="Walk me through it"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => enter(true)}
          />
          <Button
            label="I'll explore on my own"
            variant="tertiary"
            size="md"
            fullWidth
            onPress={() => enter(false)}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

// Deliberately identical to the notifications screen's layout — the two are
// consecutive, so any difference in margins reads as a jump between them.
const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[12],
    paddingBottom: Spacing[8],
    justifyContent: 'space-between',
  },
  copy: { gap: Spacing[3] },
  lead: { marginTop: Spacing[2], lineHeight: 26 },
  actions: { gap: Spacing[3] },
});
