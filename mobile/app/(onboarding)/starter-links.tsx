import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinkIcon } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';
import { Colors, FontFamily, FontSize, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

const LINK_COUNT = 3;

type LinkState = { url: string; status: 'idle' | 'loading' | 'ok' | 'error'; title?: string };

export default function StarterLinksScreen() {
  const router = useRouter();
  const [links, setLinks] = useState<LinkState[]>(
    Array.from({ length: LINK_COUNT }, () => ({ url: '', status: 'idle' })),
  );
  const [submitting, setSubmitting] = useState(false);

  const updateLink = (idx: number, url: string) => {
    setLinks((prev) => {
      const next = [...prev];
      next[idx] = { url, status: 'idle' };
      return next;
    });
  };

  const pasteLink = async (idx: number) => {
    const clipboardText = (await Clipboard.getStringAsync()).trim();
    if (!clipboardText) {
      return;
    }
    updateLink(idx, clipboardText);
  };

  const previewLink = async (idx: number) => {
    const url = links[idx].url.trim();
    if (!url) return;
    setLinks((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], status: 'loading' };
      return next;
    });
    try {
      const result = await api.content.ingest(url);
      setLinks((prev) => {
        const next = [...prev];
        next[idx] = { url, status: 'ok', title: result.contentItem.title ?? url };
        return next;
      });
    } catch {
      setLinks((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], status: 'error' };
        return next;
      });
    }
  };

  const handleSubmit = async () => {
    const validLinks = links.filter((l) => l.url.trim() && l.status === 'ok');
    setSubmitting(true);
    try {
      await Promise.all(
        validLinks.map(async (l) => {
          const ingest = await api.content.ingest(l.url.trim());
          if (ingest.contentItem.id) {
            await api.logs.create({ contentItemId: ingest.contentItem.id });
          }
        }),
      );
    } catch {
      // continue even if some fail
    } finally {
      setSubmitting(false);
      router.push('/(onboarding)/preview');
    }
  };

  const hasAnyValid = links.some((l) => l.status === 'ok');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.dots}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={[styles.dot, i < 3 && styles.dotFilled, i === 2 && styles.dotActive]} />
            ))}
          </View>

          <View style={styles.header}>
            <Text style={{ fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.accentGold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
              Step 3 of 4
            </Text>
            <Text variant="h2">Seed your profile.</Text>
            <Text variant="body" color="secondary" style={styles.subtitle}>
              Paste up to 3 URLs — an essay, video, article, or book — that represent your taste. We'll analyze them to start building your intellectual fingerprint.
            </Text>
          </View>

          {Array.from({ length: LINK_COUNT }).map((_, idx) => {
            const link = links[idx];
            return (
              <View key={idx} style={styles.linkRow}>
                <Input
                  label={`Link ${idx + 1}${idx === 0 ? '' : ' (optional)'}`}
                  value={link.url}
                  onChangeText={(t) => updateLink(idx, t)}
                  placeholder="https://..."
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => previewLink(idx)}
                  leftIcon={<LinkIcon size={16} color={Colors.mutedText} />}
                />
                <View style={styles.linkActionsRow}>
                  <Button
                    label="Paste"
                    onPress={() => {
                      void pasteLink(idx);
                    }}
                    variant="tertiary"
                    size="sm"
                  />
                </View>
                {link.status === 'loading' && (
                  <ActivityIndicator size="small" color={Colors.accentGold} style={styles.indicator} />
                )}
                {link.status === 'ok' && link.title && (
                  <View style={styles.preview}>
                    <Text variant="monoSmall" color="success">✓ {link.title}</Text>
                  </View>
                )}
                {link.status === 'error' && (
                  <Text variant="monoSmall" color="danger" style={styles.linkError}>
                    Could not fetch this URL. Check the link and try again.
                  </Text>
                )}
                {link.url.trim() && link.status === 'idle' && (
                  <Button
                    label="Preview"
                    onPress={() => previewLink(idx)}
                    variant="tertiary"
                    size="sm"
                    style={styles.previewBtn}
                  />
                )}
              </View>
            );
          })}

          <View style={styles.footer}>
            <Button
              label="Skip for now"
              onPress={() => router.push('/(onboarding)/preview')}
              variant="tertiary"
              size="md"
            />
            <Button
              label={submitting ? 'Saving…' : 'Continue →'}
              onPress={handleSubmit}
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={!hasAnyValid && !submitting}
              style={styles.continueBtn}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[8] },
  dots: { flexDirection: 'row', gap: 8, paddingTop: Spacing[6], paddingBottom: Spacing[4] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.cardBorder, borderWidth: 1, borderColor: Colors.cardBorder },
  dotFilled: { backgroundColor: Colors.accentGold, borderColor: Colors.accentGold },
  dotActive: { width: 24 },
  header: { marginBottom: Spacing[6] },
  subtitle: { marginTop: Spacing[2] },
  linkRow: { marginBottom: Spacing[2] },
  linkActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: -Spacing[2],
    marginBottom: Spacing[2],
  },
  indicator: { alignSelf: 'flex-start', marginTop: -Spacing[3], marginBottom: Spacing[2] },
  preview: {
    backgroundColor: 'rgba(120,211,157,0.1)',
    borderRadius: 8,
    padding: Spacing[3],
    marginTop: -Spacing[2],
    marginBottom: Spacing[2],
  },
  linkError: { marginTop: -Spacing[2], marginBottom: Spacing[2] },
  previewBtn: { alignSelf: 'flex-start', marginTop: -Spacing[2] },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing[4],
  },
  continueBtn: { minWidth: 140 },
});
