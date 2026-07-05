import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { LoadingDots } from '@/components/ui/LoadingDots';

interface Props {
  title: string;
  body: string;
  /** Show the animated loading dots instead of the static "· · ·" marker. */
  loading?: boolean;
}

/**
 * The shared empty / intro block used across the tab screens (pulse, drift,
 * mind). Keeps the marker, serif title, and mono body identical everywhere so
 * the screens read as one product instead of three.
 */
export function ScreenIntro({ title, body, loading = false }: Props) {
  const c = useThemeColors();
  return (
    <View style={styles.wrap}>
      {loading ? (
        <View style={styles.marker}>
          <LoadingDots size={5} />
        </View>
      ) : (
        <Text variant="monoSmall" style={[styles.dots, { color: c.faint }]}>
          · · ·
        </Text>
      )}
      <Text variant="serif" color="primary" style={styles.title}>
        {title}
      </Text>
      <Text variant="monoSmall" color="muted" style={styles.body}>
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: Spacing[20],
    paddingHorizontal: Spacing[8],
    alignItems: 'center',
  },
  marker: {
    marginBottom: Spacing[5],
  },
  dots: {
    letterSpacing: 4,
    marginBottom: Spacing[5],
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
});
