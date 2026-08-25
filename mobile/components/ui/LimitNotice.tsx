import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';

/**
 * "You've run out" — the one way every free-plan cap is shown: the server's
 * sentence (what ran out, when it resets on the user's clock, the upsell)
 * plus a single tap into the paywall. Used wherever a cap can bite: the
 * capture reaction step, the post-capture alert, the share-sheet result,
 * the companion, Socratic threads, and voice notes.
 */
export function LimitNotice({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  const c = useThemeColors();
  const router = useRouter();
  return (
    <View style={[styles.root, style]}>
      <Text variant="monoSmall" color="danger">{message}</Text>
      <Pressable
        onPress={() => {
          track('paywall_view', { source: 'limit' });
          router.push('/plus?from=limit' as never);
        }}
        accessibilityRole="button"
        accessibilityLabel="Get Mneme Plus"
        hitSlop={8}
        style={styles.cta}
      >
        <Text variant="monoSmall" style={{ color: c.text }}>get Mneme Plus →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing[2] },
  cta: { alignSelf: 'flex-start' },
});
