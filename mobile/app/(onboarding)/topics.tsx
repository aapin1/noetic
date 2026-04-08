import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { ONBOARDING_TOPICS } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

const MIN_TOPICS = 5;
const MAX_TOPICS = 10;

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i < current && styles.dotFilled,
            i === current - 1 && styles.dotActive,
          ]}
        />
      ))}
    </View>
  );
}

export default function TopicsScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (topic: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else if (next.size < MAX_TOPICS) {
        next.add(topic);
      }
      return next;
    });
  };

  const canContinue = selected.size >= MIN_TOPICS;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <ProgressDots current={1} total={4} />

        <View style={styles.header}>
          <Text
            style={{
              fontFamily: FontFamily.mono,
              fontSize: FontSize.xs,
              color: Colors.accentGold,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Step 1 of 4
          </Text>
          <Text variant="h2">What do you think about?</Text>
          <Text variant="body" color="secondary" style={styles.subtitle}>
            Choose between {MIN_TOPICS} and {MAX_TOPICS} topics that define your intellectual life.
          </Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {ONBOARDING_TOPICS.map((topic) => {
            const isSelected = selected.has(topic);
            const isDisabled = !isSelected && selected.size >= MAX_TOPICS;
            return (
              <Pressable
                key={topic}
                onPress={() => toggle(topic)}
                disabled={isDisabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected, disabled: isDisabled }}
                accessibilityLabel={topic}
                style={[
                  styles.topicChip,
                  isSelected && styles.topicChipSelected,
                  isDisabled && styles.topicChipDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.topicLabel,
                    isSelected && styles.topicLabelSelected,
                    isDisabled && styles.topicLabelDisabled,
                  ]}
                >
                  {topic}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Text variant="monoSmall" color="muted" style={styles.count}>
            {selected.size}/{MAX_TOPICS} selected
          </Text>
          <Button
            label="Continue →"
            onPress={() => router.push('/(onboarding)/preferences')}
            variant="primary"
            size="lg"
            disabled={!canContinue}
            accessibilityLabel={`Continue with ${selected.size} topics selected`}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, paddingHorizontal: Spacing[6] },
  dots: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: Spacing[6],
    paddingBottom: Spacing[4],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.cardBorder,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  dotFilled: {
    backgroundColor: Colors.accentGold,
    borderColor: Colors.accentGold,
  },
  dotActive: {
    width: 24,
    backgroundColor: Colors.accentGold,
    borderColor: Colors.accentGold,
  },
  header: { marginBottom: Spacing[5] },
  subtitle: { marginTop: Spacing[2] },
  scroll: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    paddingBottom: Spacing[4],
  },
  topicChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.surface,
  },
  topicChipSelected: {
    borderColor: Colors.accentGold,
    backgroundColor: Colors.accentGoldLight,
  },
  topicChipDisabled: {
    opacity: 0.35,
  },
  topicLabel: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: FontSize.sm,
    color: Colors.secondaryText,
  },
  topicLabelSelected: {
    color: Colors.primaryText,
  },
  topicLabelDisabled: {
    color: Colors.mutedText,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing[5],
  },
  count: {},
});
