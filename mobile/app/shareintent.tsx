import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import * as FileSystem from 'expo-file-system';
import { api } from '@/lib/api';
import { clearSharedCapture, rememberSharedCapture } from '@/lib/lastShared';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { Radius, Spacing } from '@/constants/theme';

type Status = 'working' | 'saved' | 'error';

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Entry point for items shared into Mneme from the iOS/Android share sheet.
 * Saves immediately — sharing IS the capture; no form stands between the
 * share sheet and the map. The confirmation offers the insight as an optional
 * next step rather than a required one.
 */
export default function ShareIntentScreen() {
  const router = useRouter();
  const c = useThemeColors();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { isLoading, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<Status>('working');
  const [message, setMessage] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState<string>('');
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current || isLoading) return;

    // No session yet — can't capture. Send them to sign in and drop the intent.
    if (!isAuthenticated) {
      handledRef.current = true;
      resetShareIntent();
      router.replace('/(auth)/sign-in');
      return;
    }

    if (!hasShareIntent) return; // wait for the native payload to populate
    handledRef.current = true;

    (async () => {
      try {
        let res;
        if (shareIntent.webUrl) {
          res = await api.captures.create({ kind: 'LINK', url: shareIntent.webUrl });
        } else if (shareIntent.files && shareIntent.files.length > 0) {
          const file = shareIntent.files[0];
          const uri = file.path.startsWith('file://') ? file.path : `file://${file.path}`;
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const { mediaUrl } = await api.captures.upload(base64, file.mimeType);
          res = await api.captures.create({ kind: 'IMAGE', mediaUrl });
        } else if (shareIntent.text) {
          const trimmed = shareIntent.text.trim();
          res = URL_RE.test(trimmed)
            ? await api.captures.create({ kind: 'LINK', url: trimmed })
            : await api.captures.create({ kind: 'TEXT', text: trimmed });
        } else {
          throw new Error('Nothing to capture from that share.');
        }

        resetShareIntent();
        // If they leave without opening the insight (the common share-sheet
        // exit), the map offers it again on the next app open.
        void rememberSharedCapture(res.id);
        setSavedId(res.id);
        setSavedTitle(res.title);
        setStatus('saved');
      } catch (e) {
        resetShareIntent();
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Could not save that.');
      }
    })();
  }, [isLoading, isAuthenticated, hasShareIntent, shareIntent, resetShareIntent, router]);

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {status === 'working' && (
        <AsciiLoader
          size={110}
          // Staged to mirror the real pipeline and hold at the end; the last
          // message explains the slow path (video transcription, bot-walled
          // articles) instead of looping back to an earlier stage.
          message={[
            'reading the source…',
            'placing it on your map…',
            'writing your insight…',
            'big source — this can take a moment…',
          ]}
          schedule={[6000, 5000, 6000]}
        />
      )}

      {status === 'saved' && (
        <View style={styles.savedWrap}>
          <AsciiLoader idle variant="cat" size={72} />
          <Text variant="serif" color="primary" style={styles.savedTitle}>
            saved to your map ✓
          </Text>
          {!!savedTitle && (
            <Text variant="monoSmall" color="muted" numberOfLines={2} style={styles.savedName}>
              {savedTitle}
            </Text>
          )}
          <Pressable
            onPress={() => {
              void clearSharedCapture();
              router.replace(`/insight/${savedId}` as never);
            }}
            style={[styles.primaryBtn, { backgroundColor: c.text }]}
            accessibilityRole="button"
            accessibilityLabel="Open the insight for this capture"
          >
            <Text variant="monoSmall" style={{ color: c.background }}>see the insight →</Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace('/(tabs)' as never)}
            style={styles.secondaryBtn}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text variant="monoSmall" color="muted">done</Text>
          </Pressable>
        </View>
      )}

      {status === 'error' && (
        <>
          <Text variant="monoSmall" color="danger" style={styles.message}>
            {message}
          </Text>
          <Pressable onPress={() => router.replace('/(tabs)')} style={styles.back}>
            <Text variant="monoSmall" style={{ color: c.text }}>← back to Mneme</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
  message: { marginTop: Spacing[4], textAlign: 'center' },
  back: { marginTop: Spacing[5] },
  savedWrap: { alignItems: 'center' },
  savedTitle: { marginTop: Spacing[2] },
  savedName: { marginTop: Spacing[3], maxWidth: 280, textAlign: 'center' },
  primaryBtn: {
    marginTop: Spacing[8],
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.xs,
  },
  secondaryBtn: { marginTop: Spacing[5], padding: Spacing[2] },
});
