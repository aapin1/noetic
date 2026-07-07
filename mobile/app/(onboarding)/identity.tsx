import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { InsightStyle } from '@/types/api';

const STYLES: { id: InsightStyle; label: string }[] = [
  { id: 'DIRECT', label: 'Direct' },
  { id: 'REFLECTIVE', label: 'Reflective' },
  { id: 'ANALYTICAL', label: 'Analytical' },
];

export default function IdentityScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const { topics: topicsJson } = useLocalSearchParams<{ topics: string }>();
  const topics: string[] = (() => {
    try {
      return JSON.parse(topicsJson ?? '[]') as string[];
    } catch {
      return [];
    }
  })();

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [insightStyle, setInsightStyle] = useState<InsightStyle>('DIRECT');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (topics.length < 3) {
      setError('Return to topics and choose at least three.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.profile.onboarding({
        topics,
        displayName: displayName.trim() || undefined,
        handle: handle.trim() || undefined,
        insightStyle,
      });
      await refreshProfile();
      router.replace('/(onboarding)/walkthrough');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish setup.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text variant="label" color="muted">
            Setup · 2 of 3
          </Text>
          <Text variant="h2" style={{ marginTop: Spacing[2] }}>
            How should your insights read?
          </Text>
          <Text variant="body" color="secondary" style={{ marginTop: Spacing[2] }}>
            Name and handle are optional. Pick a tone that fits you.
          </Text>

          {error ? (
            <Text variant="caption" color="danger" style={{ marginTop: Spacing[4] }}>
              {error}
            </Text>
          ) : null}

          <Input
            label="Display name (optional)"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />
          <Input
            label="Handle (optional)"
            value={handle}
            onChangeText={(t) => setHandle(t.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24).toLowerCase())}
            autoCapitalize="none"
            hint="Leave blank for a random anonymous handle."
          />

          <Text variant="label" color="muted" style={{ marginTop: Spacing[2] }}>
            Insight voice
          </Text>
          <View style={styles.styleRow}>
            {STYLES.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setInsightStyle(s.id)}
                style={[
                  styles.styleChip,
                  {
                    borderColor: insightStyle === s.id ? c.text : c.border,
                    backgroundColor: insightStyle === s.id ? c.elevated : 'transparent',
                  },
                ]}
              >
                <Text variant="caption" color={insightStyle === s.id ? 'primary' : 'muted'}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Button
            label={loading ? 'Saving…' : 'Continue'}
            onPress={() => void submit()}
            loading={loading}
            variant="primary"
            size="lg"
            fullWidth
            style={{ marginTop: Spacing[8] }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[12] },
  styleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginTop: Spacing[3] },
  styleChip: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: 999,
    borderWidth: 1,
  },
});
