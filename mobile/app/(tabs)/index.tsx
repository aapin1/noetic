import React, { useCallback, useEffect, useState } from 'react';
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
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { EncodingType, readAsStringAsync } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Image as ImageIcon, Link2, Quote, Type } from 'lucide-react-native';
import { api } from '@/lib/api';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Brain } from '@/components/Brain';
import type { CaptureKind } from '@/types/api';

type Mode = 'link' | 'text' | 'quote' | 'image';

function looksLikeUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

function normalizeLinkInput(raw: string) {
  const value = raw.trim();
  if (!value) return value;
  if (looksLikeUrl(value)) return value;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#]|$)/i.test(value)) {
    return `https://${value}`;
  }
  return value;
}

export default function CaptureScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('link');
  const [payload, setPayload] = useState('');
  const [reaction, setReaction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const applyIncomingUrl = useCallback((raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (looksLikeUrl(t)) {
      setMode('link');
      setPayload(t);
      return;
    }
    setMode('text');
    setPayload(t);
  }, []);

  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      const parsed = Linking.parse(url);
      const q = parsed.queryParams?.url;
      if (typeof q === 'string') applyIncomingUrl(q);
    };
    void Linking.getInitialURL().then((u) => u && onUrl({ url: u }));
    const sub = Linking.addEventListener('url', onUrl);
    return () => sub.remove();
  }, [applyIncomingUrl]);

  const pasteFromClipboard = async () => {
    const t = (await Clipboard.getStringAsync()).trim();
    if (!t) {
      setError('Clipboard empty.');
      return;
    }
    setError('');
    applyIncomingUrl(t);
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library access denied.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setError('');
    setBusy(true);
    try {
      const mime = asset.mimeType ?? 'image/jpeg';
      const dataUrl = asset.base64 ? `data:${mime};base64,${asset.base64}` : '';
      let mediaUrl: string;
      if (dataUrl) {
        const up = await api.captures.upload(dataUrl, mime);
        mediaUrl = up.mediaUrl;
      } else if (asset.uri) {
        const b64 = await readAsStringAsync(asset.uri, {
          encoding: EncodingType.Base64,
        });
        const up = await api.captures.upload(`data:${mime};base64,${b64}`, mime);
        mediaUrl = up.mediaUrl;
      } else {
        throw new Error('Could not read image.');
      }
      const cap = await api.captures.create({
        kind: 'IMAGE',
        mediaUrl,
        reaction: reaction.trim() || undefined,
      });
      router.push(`/insight/${cap.id}` as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image capture failed.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setError('');
    const trimmed = payload.trim();
    if (!trimmed && mode !== 'image') {
      setError('Add a link or thought first.');
      return;
    }
    setBusy(true);
    try {
      let kind: CaptureKind = 'TEXT';
      let url: string | undefined;
      let text: string | undefined;
      if (mode === 'link') {
        kind = 'LINK';
        url = normalizeLinkInput(trimmed);
      } else if (mode === 'quote') {
        kind = 'QUOTE';
        text = trimmed;
      } else {
        kind = 'TEXT';
        text = trimmed;
      }
      const cap = await api.captures.create({
        kind,
        url,
        text,
        reaction: reaction.trim() || undefined,
      });
      setPayload('');
      setReaction('');
      router.push(`/insight/${cap.id}` as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Capture failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroRow}>
            <Text variant="wordmark" color="primary">
              noetic
            </Text>
            <Brain size={72} density={48} intensity={0.9} />
          </View>

          <Text variant="h1" style={styles.lead}>
            Capture once.
          </Text>
          <Text variant="serif" color="secondary" style={styles.sub}>
            The system maps it. Insight follows immediately.
          </Text>

          <View style={[styles.modeRow, { borderColor: c.border }]}>
            {(
              [
                ['link', 'Link', Link2] as const,
                ['text', 'Thought', Type] as const,
                ['quote', 'Quote', Quote] as const,
                ['image', 'Image', ImageIcon] as const,
              ] as const
            ).map(([key, label, Icon]) => {
              const active = mode === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    setMode(key);
                    setError('');
                  }}
                  style={[
                    styles.modeBtn,
                    {
                      borderColor: active ? c.text : c.borderSubtle,
                      backgroundColor: active ? c.elevated : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={label}
                >
                  <Icon size={16} color={active ? c.text : c.muted} />
                  <Text variant="caption" color={active ? 'primary' : 'muted'} style={styles.modeLabel}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'image' && (
            <View style={[styles.captureCard, { borderColor: c.border, backgroundColor: c.surface }]}>
              <Text variant="body" color="secondary">
                Stored privately. Insight is synthesized from signal—even without a caption.
              </Text>
              <Button
                label={busy ? 'Working…' : 'Choose image'}
                onPress={() => void pickImage()}
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                style={{ marginTop: Spacing[4] }}
              />
            </View>
          )}

          {mode !== 'image' && (
            <View style={[styles.captureCard, { borderColor: c.border, backgroundColor: c.surface }]}>
              <Text variant="label" color="muted" style={{ marginBottom: Spacing[2] }}>
                {mode === 'link' ? 'URL' : mode === 'quote' ? 'Quoted text' : 'Thought'}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { color: c.text, fontFamily: FontFamily.serif, borderColor: c.borderSubtle },
                ]}
                value={payload}
                onChangeText={setPayload}
                placeholder={
                  mode === 'link'
                    ? 'https://…'
                    : mode === 'quote'
                      ? 'Paste a passage…'
                      : 'One line. Fragments are fine.'
                }
                placeholderTextColor={c.faint}
                multiline
                autoCapitalize={mode === 'link' ? 'none' : 'sentences'}
                keyboardType={mode === 'link' ? 'url' : 'default'}
              />
              <Pressable
                onPress={() => void pasteFromClipboard()}
                style={styles.pasteBtn}
                accessibilityRole="button"
                accessibilityLabel="Paste from clipboard"
              >
                <Text variant="monoSmall" color="muted">
                  Paste from clipboard
                </Text>
              </Pressable>
            </View>
          )}

          <View style={{ marginTop: Spacing[4] }}>
            <Text variant="label" color="muted" style={{ marginBottom: Spacing[2] }}>
              Optional reaction (one line)
            </Text>
            <TextInput
              style={[
                styles.reaction,
                { color: c.text, borderColor: c.border, fontFamily: FontFamily.sans },
              ]}
              value={reaction}
              onChangeText={setReaction}
              placeholder="A single reflex. Or leave empty."
              placeholderTextColor={c.faint}
            />
          </View>

          {error ? (
            <Text variant="caption" color="danger" style={{ marginTop: Spacing[3] }}>
              {error}
            </Text>
          ) : null}

          {mode !== 'image' && (
            <Button
              label={busy ? 'Synthesizing…' : 'Commit to memory'}
              onPress={() => void commit()}
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              style={{ marginTop: Spacing[6] }}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[14],
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[4],
  },
  lead: {
    marginTop: Spacing[6],
  },
  sub: {
    marginTop: Spacing[3],
    maxWidth: 320,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginTop: Spacing[6],
    paddingBottom: Spacing[4],
    borderBottomWidth: 1,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  modeLabel: { marginLeft: 2 },
  captureCard: {
    marginTop: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
  },
  input: {
    borderWidth: 0,
    borderBottomWidth: 1,
    minHeight: 96,
    fontSize: FontSize.md,
    paddingVertical: Spacing[2],
  },
  pasteBtn: { marginTop: Spacing[3], alignSelf: 'flex-start' },
  reaction: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    fontSize: FontSize.base,
  },
});
