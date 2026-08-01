import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing } from '@/constants/theme';
import { Text } from './Text';
import { InfoModal } from './InfoModal';

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
 * that protects it is never advertised in advance either: the copy below
 * mentions it only once one has actually been spent.
 */

/** Below this a streak is noise — "1" is just "you used the app today". */
const MIN_VISIBLE = 2;

export function StreakMark() {
  const [infoVisible, setInfoVisible] = useState(false);
  const { data } = useApiQuery(() => api.profile.streak(), [], { cacheKey: 'home.streak' });

  const current = data?.current ?? 0;
  const held = data?.heldDays ?? 0;
  if (current < MIN_VISIBLE) return null;

  return (
    <>
      <Pressable
        onPress={() => setInfoVisible(true)}
        hitSlop={12}
        style={styles.wrap}
        pointerEvents="auto"
        accessibilityRole="button"
        accessibilityLabel={`${current} day streak`}
      >
        {/* Filled while the run is unbroken; hollow once a freeze is holding
            part of it — a quiet, after-the-fact acknowledgement, not a flag. */}
        <Text style={[styles.glyph, held > 0 && styles.glyphHeld]}>{held > 0 ? '◇' : '◆'}</Text>
        <Text style={styles.count}>{current}</Text>
      </Pressable>

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="streak"
        body={
          held > 0
            ? `${current} days running. you missed one of them — we held it for you, so the run kept going. every day you save something adds one.`
            : `${current} days running. every day you save something adds one. nothing you have to keep up with — it just counts what you have been doing.`
        }
      />
    </>
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
