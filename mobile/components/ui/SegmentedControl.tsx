import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

interface Props<K extends string> {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  style?: ViewStyle;
}

/**
 * The iOS segmented control: a recessed track with one raised segment. Used
 * to switch between views of the same content (Diary / Folders), never to
 * navigate.
 */
export function SegmentedControl<K extends string>({ options, value, onChange, style }: Props<K>) {
  const c = useThemeColors();
  return (
    <View style={[styles.track, { backgroundColor: c.elevated }, style]} accessibilityRole="tablist">
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync();
              onChange(opt.key);
            }}
            style={[styles.segment, selected && [styles.selected, { backgroundColor: c.surface, shadowColor: c.text }]]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
          >
            <Text variant={selected ? 'bodySemiBold' : 'body'} style={styles.label} color={selected ? 'primary' : 'secondary'}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md + 1,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    paddingVertical: Spacing[1] + 2,
  },
  selected: {
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  label: { fontSize: 13, lineHeight: 18 },
});
