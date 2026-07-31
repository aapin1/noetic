import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { markAskedForPush } from '@/lib/storage';
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
    finish();
  };

  const decline = () => {
    void markAskedForPush();
    finish();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.copy}>
          <Text variant="label" color="muted">
            Setup · 2 of 2
          </Text>
          <Text variant="h2" style={{ marginTop: Spacing[2] }}>
            Want to hear when something surfaces?
          </Text>

          <Text variant="body" color="secondary" style={{ marginTop: Spacing[3] }}>
            mneme keeps reading after you save. When two things you saved
            disagree, or a thread you'd left alone starts moving again, that's
            usually worth knowing about.
          </Text>

          <Text variant="body" color="secondary" style={{ marginTop: Spacing[3] }}>
            Right now the only way to find out is to open the app and go
            looking. This is how it reaches you instead.
          </Text>

          <Text variant="caption" color="muted" style={{ marginTop: Spacing[5] }}>
            At most one a day, and only when there's something specific to say.
            It will never be a badge with a number on it.
          </Text>
        </View>

        <View style={styles.actions}>
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
