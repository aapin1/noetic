import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Link2 } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

const SLOTS = 2;

export default function StarterLinksScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>(() => Array.from({ length: SLOTS }, () => ''));
  const [busy, setBusy] = useState(false);

  const setUrl = (i: number, v: string) => {
    setUrls((prev) => {
      const n = [...prev];
      n[i] = v;
      return n;
    });
  };

  const paste = async (i: number) => {
    const t = (await Clipboard.getStringAsync()).trim();
    if (t) setUrl(i, t);
  };

  const commitLinks = async () => {
    setBusy(true);
    try {
      const trimmed = urls.map((u) => u.trim()).filter(Boolean);
      for (const u of trimmed) {
        await api.captures.create({ kind: 'LINK', url: u });
      }
    } catch {
      // Non-blocking: user still enters app; cognition may partial fail per URL
    } finally {
      setBusy(false);
      router.replace('/(onboarding)/preview');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="label" color="muted">
            Setup · 3 of 3
          </Text>
          <Text variant="h2" style={{ marginTop: Spacing[2] }}>
            Add a link or two (optional)
          </Text>
          <Text variant="body" color="secondary" style={{ marginTop: Spacing[2] }}>
            Paste a link and we'll show you an insight from it right away. Or skip and start empty.
          </Text>

          {urls.map((url, i) => (
            <View key={i} style={{ marginTop: Spacing[4] }}>
              <Input
                label={i === 0 ? 'Link (optional)' : 'Second link (optional)'}
                value={url}
                onChangeText={(t) => setUrl(i, t)}
                placeholder="https://…"
                keyboardType="url"
                autoCapitalize="none"
                leftIcon={<Link2 size={16} color={c.muted} />}
              />
              <Pressable onPress={() => void paste(i)} style={{ marginTop: -Spacing[2] }}>
                <Text variant="monoSmall" color="muted">
                  Paste
                </Text>
              </Pressable>
            </View>
          ))}

          <View style={styles.row}>
            <Button label="Skip" variant="tertiary" size="md" onPress={() => router.replace('/(onboarding)/preview')} />
            <Button
              label={busy ? 'Saving…' : 'Save & preview'}
              variant="primary"
              size="md"
              loading={busy}
              onPress={() => void commitLinks()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[12] },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing[8],
    gap: Spacing[4],
  },
});
