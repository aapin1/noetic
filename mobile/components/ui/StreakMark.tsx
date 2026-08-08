import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { Text } from './Text';

/**
 * The streak, in the one place it can actually be defended.
 *
 * It used to exist only inside the wrapped run on the profile tab, which meant
 * a user who never opened that tab could not see a streak and so could not act
 * on one. Here it sits next to the thing that keeps it going.
 *
 * Deliberately quiet. No countdown, no colour change as the day runs out, no
 * "don't lose it" — a streak you have to defend against the app is a chore, and
 * this is meant to read as a record of attention rather than a debt. The freeze
 * that protects it is never advertised in advance either.
 *
 * Tapping it opens /today — the daily ritual is what a streak is *for*, and
 * that screen carries the explanation this mark used to show in a modal.
 */

/** Below this a streak is noise — "1" is just "you used the app today". */
const MIN_VISIBLE = 2;

export function StreakMark() {
  const router = useRouter();
  const { data } = useApiQuery(() => api.profile.streak(), [], { cacheKey: 'home.streak' });

  const current = data?.current ?? 0;
  const held = data?.heldDays ?? 0;
  if (current < MIN_VISIBLE) return null;

  return (
    <Pressable
      onPress={() => router.push('/today' as never)}
      hitSlop={12}
      style={styles.wrap}
      pointerEvents="auto"
      accessibilityRole="button"
      accessibilityLabel={`${current} day streak — open today`}
    >
      {/* Filled while the run is unbroken; hollow once a freeze is holding
          part of it — a quiet, after-the-fact acknowledgement, not a flag. */}
      <Text style={[styles.glyph, held > 0 && styles.glyphHeld]}>{held > 0 ? '◇' : '◆'}</Text>
      <Text style={styles.count}>{current}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: Spacing[3],
  },
  glyph: {
    color: 'rgba(240,232,214,0.49)',
    fontSize: 11,
    marginRight: 4,
  },
  glyphHeld: {
    color: 'rgba(240,232,214,0.36)',
  },
  count: {
    color: 'rgba(240,232,214,0.62)',
    fontSize: 13,
  },
});
