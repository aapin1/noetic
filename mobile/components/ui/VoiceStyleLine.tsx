import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { XIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useDisclosure } from '@/contexts/DisclosureContext';
import { EVENT_FLAGS } from '@/lib/disclosure';
import type { InsightStyle } from '@/types/api';
import { SegmentedControl } from './SegmentedControl';
import { Text } from './Text';

const CHOICES: { key: InsightStyle; label: string }[] = [
  { key: 'DIRECT', label: 'Direct' },
  { key: 'REFLECTIVE', label: 'Reflective' },
  { key: 'ANALYTICAL', label: 'Analytical' },
];

/**
 * The insight-voice choice, moved out of onboarding and into the first place
 * it means anything: under an insight the user is actually reading. A title,
 * one line on what it does, a segmented control, and a close button. Stays until acted on, then never
 * returns (DIRECT remains the server default when dismissed).
 */
export function VoiceStyleLine() {
  const c = useThemeColors();
  const { ready, hasSeen, markSeen } = useDisclosure();
  const [chosen, setChosen] = useState<InsightStyle | null>(null);

  if (!ready || hasSeen(EVENT_FLAGS.voiceStyleChosen)) return null;

  const choose = (style: InsightStyle) => {
    setChosen(style);
    // Optimistic: the server default is DIRECT either way, and a lost PATCH
    // costs one preference, never a blocked reading flow.
    void api.preferences.update({ insightStyle: style }).catch(() => {});
    setTimeout(() => markSeen(EVENT_FLAGS.voiceStyleChosen), 1600);
  };

  if (chosen) {
    return (
      <View style={styles.wrap}>
        <Text variant="subheadline" color="secondary">
          New insights will be written in the {CHOICES.find((ch) => ch.key === chosen)?.label.toLowerCase()} style.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text variant="headline">Choose an insight style</Text>
          <Text variant="subheadline" color="secondary" style={styles.headLine}>
            Applies to the insights written from now on.
          </Text>
        </View>
        <Pressable
          onPress={() => markSeen(EVENT_FLAGS.voiceStyleChosen)}
          hitSlop={8}
          accessibilityLabel="Keep the current insight style"
        >
          <XIcon size={18} color={c.faint} />
        </Pressable>
      </View>
      <SegmentedControl options={CHOICES} value={'DIRECT' as InsightStyle} onChange={choose} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing[5],
    gap: Spacing[3],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing[3],
  },
  headText: { flex: 1 },
  headLine: { marginTop: 2 },
});
