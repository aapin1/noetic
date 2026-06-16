import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

export default function PositionCreateScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { topicId, topicName, captureCount } = useLocalSearchParams<{
    topicId: string;
    topicName: string;
    captureCount: string;
  }>();

  const [statement, setStatement] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = statement.trim().length >= 10 && !saving;

  async function handleSubmit() {
    if (!canSubmit || !topicId) return;
    setSaving(true);
    setError(null);
    try {
      await api.positions.create({
        topicId,
        statement,
        captureCountAtCreation: parseInt(captureCount ?? '0', 10),
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text variant="body" color="muted">Cancel</Text>
          </Pressable>
          <Text variant="wordmark" style={{ fontSize: 16 }}>Take a position</Text>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={styles.doneBtn}
          >
            <Text variant="bodyMedium" color={canSubmit ? 'primary' : 'muted'}>
              {saving ? 'Saving…' : 'Done'}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="monoSmall" color="muted" style={styles.topicLabel}>
            {topicName ?? 'Topic'}
          </Text>
          <Text variant="body" color="secondary" style={styles.prompt}>
            After exploring this thread, where has your thinking landed?
          </Text>
          <TextInput
            style={[styles.input, { color: c.text, borderColor: c.border }]}
            placeholder="State your position…"
            placeholderTextColor={c.faint}
            value={statement}
            onChangeText={setStatement}
            multiline
            autoFocus
            textAlignVertical="top"
          />
          <Text variant="monoSmall" color="muted" style={styles.hint}>
            This becomes a thesis node on your map. New captures on this topic will be tested against it.
          </Text>
          {error && (
            <Text variant="monoSmall" style={[styles.errorText, { color: c.danger }]}>
              {error}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 60 },
  doneBtn: { minWidth: 60, alignItems: 'flex-end' },
  content: { padding: Spacing[4], gap: Spacing[4] },
  topicLabel: { textTransform: 'uppercase', letterSpacing: 1 },
  prompt: { lineHeight: 24 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[3],
    minHeight: 120,
    fontSize: 16,
    lineHeight: 24,
  },
  hint: { lineHeight: 18 },
  errorText: { marginTop: Spacing[2] },
});
