import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ONBOARDING_TOPICS, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

const MIN = 3;
const MAX = 5;

export default function TopicsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (topic: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else if (next.size < MAX) next.add(topic);
      return next;
    });
  };

  const canContinue = selected.size >= MIN;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="label" color="muted" style={styles.step}>
          Setup · 1 of 3
        </Text>
        <Text variant="h2">What do you think about most?</Text>
        <Text variant="body" color="secondary" style={styles.sub}>
          Pick {MIN} to {MAX} topics. It's just a starting point, nothing's ranked.
        </Text>

        {ONBOARDING_TOPICS.map((topic) => {
          const isSelected = selected.has(topic);
          const isDisabled = !isSelected && selected.size >= MAX;
          return (
            <Pressable
              key={topic}
              onPress={() => toggle(topic)}
              disabled={isDisabled}
              style={[
                styles.chip,
                {
                  borderColor: isSelected ? c.text : c.border,
                  backgroundColor: isSelected ? c.elevated : 'transparent',
                  opacity: isDisabled ? 0.35 : 1,
                },
              ]}
            >
              <Text variant="caption" color={isSelected ? 'primary' : 'secondary'}>
                {topic}
              </Text>
            </Pressable>
          );
        })}

        <View style={styles.footer}>
          <Text variant="monoSmall" color="muted">
            {selected.size}/{MAX}
          </Text>
          <Button
            label="Continue"
            disabled={!canContinue}
            onPress={() =>
              router.push({
                pathname: '/(onboarding)/identity',
                params: { topics: JSON.stringify(Array.from(selected)) },
              } as unknown as Href)
            }
            variant="primary"
            size="lg"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  grid: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[10],
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  step: { marginTop: Spacing[6], width: '100%', marginBottom: Spacing[2] },
  sub: { width: '100%', marginTop: Spacing[2], marginBottom: Spacing[5] },
  chip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderWidth: 1,
  },
  footer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[8],
  },
});
