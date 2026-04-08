import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';

const FORMAT_OPTIONS = ['Articles', 'Books', 'Video essays', 'Podcasts', 'Newsletters', 'Academic papers'];
const DEPTH_OPTIONS = ['Quick reads (<10 min)', 'Medium depth (10–30 min)', 'Deep dives (30+ min)', 'No preference'];
const VISIBILITY_OPTIONS = [
  { label: 'Public', description: 'Anyone can see your reviews and rankings' },
  { label: 'Followers only', description: 'Only followers see your activity' },
  { label: 'Private', description: 'Your profile is discoverable but activity is private' },
];

type OptionPickerProps = {
  label: string;
  options: string[];
  selected: Set<string>;
  multi?: boolean;
  onToggle: (opt: string) => void;
};

function OptionPicker({ label, options, selected, multi = false, onToggle }: OptionPickerProps) {
  return (
    <View style={styles.section}>
      <Text variant="label" color="secondary" style={styles.sectionLabel}>{label}</Text>
      <View style={styles.optionRow}>
        {options.map((opt) => {
          const isSelected = selected.has(opt);
          return (
            <Pressable
              key={opt}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onToggle(opt);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={opt}
              style={[styles.optionChip, isSelected && styles.optionChipSelected]}
            >
              <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function PreferencesScreen() {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [formats, setFormats] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState<Set<string>>(new Set());
  const [visibility, setVisibility] = useState('Public');
  const [error, setError] = useState('');

  const toggleFormat = (f: string) => setFormats((prev) => {
    const next = new Set(prev);
    next.has(f) ? next.delete(f) : next.add(f);
    return next;
  });

  const toggleDepth = (d: string) => setDepth(new Set([d]));

  const handleContinue = () => {
    if (!handle.trim()) { setError('A handle is required.'); return; }
    if (!/^[a-zA-Z0-9_]{2,24}$/.test(handle.trim())) {
      setError('Handle must be 2–24 characters: letters, numbers, underscores only.');
      return;
    }
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    setError('');
    router.push('/(onboarding)/starter-links');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.dots}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={[styles.dot, i < 2 && styles.dotFilled, i === 1 && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.header}>
          <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.accentGold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Step 2 of 4
          </Text>
          <Text variant="h2">Build your identity.</Text>
          <Text variant="body" color="secondary" style={styles.subtitle}>
            Set your handle and tell people who you are.
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text variant="caption" color="danger">{error}</Text>
          </View>
        ) : null}

        <Input
          label="Handle"
          value={handle}
          onChangeText={(t) => setHandle(t.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24))}
          placeholder="your_handle"
          autoCapitalize="none"
          hint="2–24 characters. Letters, numbers, underscores."
        />

        <Input
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your public name"
          autoCapitalize="words"
        />

        <Input
          label="Bio"
          value={bio}
          onChangeText={setBio}
          placeholder="What you read, watch, and think about..."
          multiline
          numberOfLines={3}
          hint="Optional. Shown on your public profile."
        />

        <OptionPicker
          label="Preferred formats"
          options={FORMAT_OPTIONS}
          selected={formats}
          multi
          onToggle={toggleFormat}
        />

        <OptionPicker
          label="Content depth"
          options={DEPTH_OPTIONS}
          selected={depth}
          onToggle={toggleDepth}
        />

        <View style={styles.section}>
          <Text variant="label" color="secondary" style={styles.sectionLabel}>Default visibility</Text>
          {VISIBILITY_OPTIONS.map((opt) => (
            <Pressable
              key={opt.label}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setVisibility(opt.label);
              }}
              style={[styles.visibilityRow, visibility === opt.label && styles.visibilitySelected]}
              accessibilityRole="radio"
              accessibilityState={{ checked: visibility === opt.label }}
              accessibilityLabel={opt.label}
              accessibilityHint={opt.description}
            >
              <View style={[styles.radio, visibility === opt.label && styles.radioFilled]} />
              <View style={styles.visibilityText}>
                <Text variant="bodyMedium">{opt.label}</Text>
                <Text variant="caption" color="muted">{opt.description}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.footer}>
          <Button
            label="Continue →"
            onPress={handleContinue}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[8] },
  dots: { flexDirection: 'row', gap: 8, paddingTop: Spacing[6], paddingBottom: Spacing[4] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.cardBorder, borderWidth: 1, borderColor: Colors.cardBorder },
  dotFilled: { backgroundColor: Colors.accentGold, borderColor: Colors.accentGold },
  dotActive: { width: 24 },
  header: { marginBottom: Spacing[5] },
  subtitle: { marginTop: Spacing[2] },
  errorBanner: {
    backgroundColor: 'rgba(232,108,108,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(232,108,108,0.3)',
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
  },
  section: { marginBottom: Spacing[6] },
  sectionLabel: { marginBottom: Spacing[3] },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  optionChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.surface,
  },
  optionChipSelected: { borderColor: Colors.accentGold, backgroundColor: Colors.accentGoldLight },
  optionLabel: { fontFamily: FontFamily.bodyMedium, fontSize: FontSize.sm, color: Colors.secondaryText },
  optionLabelSelected: { color: Colors.primaryText },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    marginBottom: Spacing[2],
    backgroundColor: Colors.surface,
  },
  visibilitySelected: { borderColor: Colors.accentGold, backgroundColor: Colors.accentGoldLight },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.inputBorder,
    marginTop: 1,
  },
  radioFilled: { borderColor: Colors.accentGold, backgroundColor: Colors.accentGold },
  visibilityText: { flex: 1 },
  footer: { marginTop: Spacing[4] },
});
