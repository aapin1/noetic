import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRightIcon, Share2Icon } from 'lucide-react-native';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

/**
 * Bottom-of-profile entry point into the recap composer. Styled to sit beside
 * the Wrapped cards — same surface, border, and mono/serif rhythm — so it reads
 * as one more shelf on the "you" page rather than a bolted-on button.
 */
export function ShareRecapEntry() {
  const c = useThemeColors();
  const router = useRouter();
  const accent = Accents.ochre;

  return (
    <View style={styles.wrap}>
      <Text variant="label" color="muted" style={styles.kicker}>
        share
      </Text>
      <Pressable
        onPress={() => router.push('/share-recap' as never)}
        accessibilityRole="button"
        accessibilityLabel="Share what you've been up to"
        style={({ pressed }) => [
          styles.card,
          { borderColor: c.border },
          pressed && { opacity: 0.75 },
        ]}
      >
        <View style={[styles.glyph, { borderColor: accent }]}>
          <Share2Icon size={20} color={accent} strokeWidth={1.6} />
        </View>
        <View style={styles.text}>
          <Text variant="h4">Share what you've been up to</Text>
          <Text variant="serif" color="secondary" style={styles.sub}>
            Turn your favorite saves into a set of cards to post.
          </Text>
        </View>
        <ChevronRightIcon size={20} color={c.faint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[6],
  },
  kicker: { marginBottom: Spacing[3] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    gap: Spacing[4],
  },
  glyph: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  sub: { marginTop: Spacing[1] },
});
