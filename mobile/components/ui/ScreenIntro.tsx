import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { AsciiLoader } from '@/components/ui/AsciiLoader';

interface Props {
  title: string;
  body: string;
  /** Show the animated loading dots instead of the idle art. */
  loading?: boolean;
  /** The screen's own mark: brain for mind, folder for archive, person for
   * pulse, chart for you. The cat is the generic fallback. */
  art?: 'cat' | 'brain' | 'folder' | 'person' | 'chart';
  /** Where to go from here. The first action is the primary button. */
  actions?: { label: string; onPress: () => void }[];
}

/**
 * THE empty-state box, identical on every tab (mind, archive, pulse, you):
 * one card with the idle mascot, a title saying what the screen is, a body
 * saying what will appear and how to make it appear, and buttons that go do
 * it. Keep the shape uniform. A new user reads this card four times and it
 * should feel like one product speaking.
 */
export function ScreenIntro({ title, body, loading = false, art = 'cat', actions }: Props) {
  const c = useThemeColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.card, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
        <View style={styles.marker}>
          {loading ? (
            <LoadingDots size={5} />
          ) : (
            <AsciiLoader idle variant={art === 'brain' ? 'brainStill' : art} size={art === 'cat' ? 64 : 72} />
          )}
        </View>
        <Text variant="h4" style={styles.title}>
          {title}
        </Text>
        <Text variant="subheadline" color="secondary" style={styles.body}>
          {body}
        </Text>
        {(actions ?? []).length > 0 ? (
          <View style={styles.actions}>
            {(actions ?? []).map((action, i) => (
              <Button
                key={action.label}
                label={action.label}
                variant={i === 0 ? 'primary' : 'secondary'}
                size="md"
                fullWidth
                onPress={action.onPress}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: Spacing[8],
    paddingHorizontal: Spacing[4],
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
    paddingVertical: Spacing[6],
    paddingHorizontal: Spacing[6],
    alignItems: 'center',
  },
  marker: {
    marginBottom: Spacing[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing[2],
  },
  body: {
    textAlign: 'center',
    maxWidth: 320,
  },
  actions: {
    width: '100%',
    marginTop: Spacing[5],
    gap: Spacing[2],
  },
});
