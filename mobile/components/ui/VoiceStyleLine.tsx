import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useDisclosure } from '@/contexts/DisclosureContext';
import { EVENT_FLAGS } from '@/lib/disclosure';
import type { InsightStyle } from '@/types/api';
import { Text } from './Text';

const CHOICES: { value: InsightStyle; label: string }[] = [
  { value: 'DIRECT', label: 'direct' },
  { value: 'REFLECTIVE', label: 'reflective' },
  { value: 'ANALYTICAL', label: 'analytical' },
];

/**
 * The insight-voice choice, moved out of onboarding and into the first place
 * it means anything: under an insight the user is actually reading. One line,
 * three words to pick from, dismissible without choosing. Stays until acted
 * on, then never returns (DIRECT remains the server default when dismissed).
 */
export function VoiceStyleLine() {
  const c = useThemeColors();
  const { ready, hasSeen, markSeen } = useDisclosure();
  const [chosen, setChosen] = useState<InsightStyle | null>(null);

  if (!ready || hasSeen(EVENT_FLAGS.voiceStyleChosen)) return null;

  const choose = (style: InsightStyle) => {
    setChosen(style);
    // Optimistic: the server default is DIRECT either way, and a lost PATCH
    // costs one preference — never a blocked reading flow.
    void api.preferences.update({ insightStyle: style }).catch(() => {});
    setTimeout(() => markSeen(EVENT_FLAGS.voiceStyleChosen), 1600);
  };

  if (chosen) {
    return (
      <View style={styles.row}>
        <Text variant="monoSmall" style={{ color: c.faint }}>
          noted — insights will be {CHOICES.find((ch) => ch.value === chosen)?.label}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Text variant="monoSmall" style={{ color: c.faint }}>
        how should these read?
      </Text>
      {CHOICES.map((choice) => (
        <Pressable key={choice.value} onPress={() => choose(choice.value)} hitSlop={6}>
          <Text variant="monoSmall" style={{ color: c.muted, textDecorationLine: 'underline' }}>
            {choice.label}
          </Text>
        </Pressable>
      ))}
      <Pressable
        onPress={() => markSeen(EVENT_FLAGS.voiceStyleChosen)}
        hitSlop={8}
        accessibilityLabel="Keep the current insight voice"
      >
        <Text variant="monoSmall" style={{ color: c.faint }}>
          ✕
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing[3],
    marginTop: Spacing[4],
  },
});
