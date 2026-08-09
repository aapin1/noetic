import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { AsciiLoader } from '@/components/ui/AsciiLoader';

interface Props {
  title: string;
  body: string;
  /** Show the animated loading dots instead of the idle cat. */
  loading?: boolean;
  /** Which pet keeps the empty screen company. */
  art?: 'cat' | 'brain';
  /** Where to go from here — an empty state should always point somewhere. */
  actions?: { label: string; onPress: () => void }[];
}

/**
 * The shared empty / intro block used across the tab screens (pulse, drift,
 * mind). An idle ASCII pet, serif title, and mono body — identical everywhere
 * so the screens read as one product instead of three.
 */
export function ScreenIntro({ title, body, loading = false, art = 'cat', actions }: Props) {
  const c = useThemeColors();
  return (
    <View style={styles.wrap}>
      {loading ? (
        <View style={styles.marker}>
          <LoadingDots size={5} />
        </View>
      ) : (
        <View style={styles.marker}>
          <AsciiLoader idle variant={art} size={art === 'cat' ? 64 : 88} />
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
          <Text variant="monoSmall" style={{ color: c.text }}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: Spacing[12],
    paddingHorizontal: Spacing[8],
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
  },
});
