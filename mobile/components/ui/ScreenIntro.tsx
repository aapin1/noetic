import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
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
  /** Where to go from here — an empty state should always point somewhere. */
  actions?: { label: string; onPress: () => void }[];
}

/**
 * THE empty-state box, identical on every tab (mind, archive, pulse, you):
 * one bordered card with the idle ASCII pet, a serif title saying what the
 * screen is, a mono body saying what will appear and how to make it appear,
 * and action links that go do it. Keep the shape uniform — a new user reads
 * this card four times and it should feel like one product speaking.
 */
export function ScreenIntro({ title, body, loading = false, art = 'cat', actions }: Props) {
  const c = useThemeColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.card, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
        {loading ? (
          <View style={styles.marker}>
            <LoadingDots size={5} />
          </View>
        ) : (
          <View style={styles.marker}>
            {/* 'brain' here means the still line-brain — the braille brain
                stays the app-wide loading mark. */}
            <AsciiLoader idle variant={art === 'brain' ? 'brainStill' : art} size={art === 'cat' ? 64 : 72} />
          </View>
        )}
        <Text variant="serif" color="primary" style={styles.title}>
          {title}
        </Text>
        <Text variant="monoSmall" color="muted" style={styles.body}>
          {body}
        </Text>
        {(actions ?? []).map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            hitSlop={8}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Text variant="monoSmall" style={{ color: c.text, textAlign: 'center' }}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: Spacing[10],
    paddingHorizontal: Spacing[5],
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[6],
    paddingHorizontal: Spacing[6],
    alignItems: 'center',
  },
  marker: {
    marginBottom: Spacing[2],
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing[4],
  },
  body: {
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  action: {
    marginTop: Spacing[4],
    paddingVertical: Spacing[1],
    alignSelf: 'center',
  },
});
