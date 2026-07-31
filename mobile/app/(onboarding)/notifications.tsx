import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { markAskedForPush } from '@/lib/storage';
import { track } from '@/lib/analytics';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

/**
 * The permission ask, as its own onboarding step.
 *
 * It sits after identity rather than before it because by this point the user
 * has an account and a token has somewhere to go. Both buttons record that we
 * asked: iOS only ever shows its system prompt once per install, so the
 * post-capture primer must not fire later and present a sheet with nothing
 * behind it.
 */
export default function NotificationsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { requestPermission } = useNotifications();
  const [busy, setBusy] = useState(false);

  const finish = () => router.replace('/(onboarding)/walkthrough');

  const accept = async () => {
    setBusy(true);
    await markAskedForPush();
    // Deliberately ignores the outcome. Someone who taps "Turn them on" and
    // then declines Apple's dialog has still finished this step, and stalling
    // them on a screen they can't satisfy would be worse than letting it go.
    await requestPermission();
    // For the same reason the event records the step, not the OS answer: this
    // measures onboarding drop-off, and both buttons complete the step.
    track('onboarding_step', { step: 'notifications', action: 'completed' });
    finish();
  };

  const decline = () => {
    void markAskedForPush();
    track('onboarding_step', { step: 'notifications', action: 'skipped' });
    finish();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.copy}>
          <Text variant="label" color="muted">
            Setup · 2 of 2
          </Text>
          <Text variant="h2">
            Want to hear when something surfaces?
          </Text>
          <Text variant="body" color="secondary" style={styles.lead}>
            mneme keeps reading after you save. When two things you saved
            disagree, or a quiet thread starts moving again, it can tell you.
          </Text>
        </View>

        <View style={styles.actions}>
          {/* The ceiling sits with the buttons, not in the body: it is the last
              thing read before deciding, and it is the objection people
              actually have. */}
          <Text variant="caption" color="muted" style={styles.footnote}>
            At most one a day, and only when there's something worth saying.
          </Text>
          <Button
            label={busy ? 'One moment…' : 'Turn on notifications'}
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            onPress={() => void accept()}
          />
          <Button
            label="Not now"
            variant="tertiary"
            size="md"
            fullWidth
            onPress={decline}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  // `gap` instead of per-element marginTop: the vertical rhythm is then one
  // number rather than four that drift apart every time the copy is edited.
  content: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[12],
    paddingBottom: Spacing[8],
    justifyContent: 'space-between',
  },
  copy: { gap: Spacing[3] },
  // A little more air under the headline than between kicker and headline,
  // so the eye reads title-then-explanation rather than three equal lines.
  lead: { marginTop: Spacing[2], lineHeight: 26 },
  actions: { gap: Spacing[3] },
  footnote: { marginBottom: Spacing[2] },
});
