import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

export default function WalkthroughOfferScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { start: startTutorial } = useTutorial();

  const enter = (withWalkthrough: boolean) => {
    router.replace('/(tabs)');
    if (withWalkthrough) startTutorial();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.copy}>
          <Text variant="label" color="muted">
            You're in
          </Text>
          <Text variant="h2" style={{ marginTop: Spacing[2] }}>
            Want a quick walkthrough?
          </Text>
          <Text variant="body" color="secondary" style={{ marginTop: Spacing[3] }}>
            I'll help you log your first node and show you around. Takes a minute.
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
            style={{ marginTop: Spacing[3] }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, paddingHorizontal: Spacing[6], paddingBottom: Spacing[8], justifyContent: 'space-between' },
  copy: { marginTop: Spacing[16] },
  actions: {},
});
