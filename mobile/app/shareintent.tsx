import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import * as FileSystem from 'expo-file-system';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Spacing } from '@/constants/theme';

type Status = 'working' | 'error';

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Entry point for items shared into Mneme from the iOS/Android share sheet.
 * Resolves the shared URL, text, or image into capture params and hands off to
 * the capture flow, dropping the user on the reaction step so nothing is saved
 * without a chance to react.
 */
export default function ShareIntentScreen() {
  const router = useRouter();
  const c = useThemeColors();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { isLoading, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<Status>('working');
  const [message, setMessage] = useState('Opening capture…');
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
        // Resolve the shared payload into capture params, then hand off to the
        // capture flow so the user always lands on the reaction step instead of
        // the item being saved silently.
        let params: Record<string, string>;

        if (shareIntent.webUrl) {
          params = { shareKind: 'LINK', shareUrl: shareIntent.webUrl };
        } else if (shareIntent.files && shareIntent.files.length > 0) {
          const file = shareIntent.files[0];
          const uri = file.path.startsWith('file://') ? file.path : `file://${file.path}`;
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const { mediaUrl } = await api.captures.upload(base64, file.mimeType);
          params = { shareKind: 'IMAGE', shareMediaUrl: mediaUrl };
        } else if (shareIntent.text) {
          const trimmed = shareIntent.text.trim();
          params = URL_RE.test(trimmed)
            ? { shareKind: 'LINK', shareUrl: trimmed }
            : { shareKind: 'TEXT', shareText: trimmed };
        } else {
          throw new Error('Nothing to capture from that share.');
        }

        resetShareIntent();
        router.replace({ pathname: '/(tabs)', params } as never);
      } catch (e) {
        resetShareIntent();
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Could not open that.');
      }
    })();
  }, [isLoading, isAuthenticated, hasShareIntent, shareIntent, resetShareIntent, router]);

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {status === 'working' && <ActivityIndicator color={c.text} />}
      <Text variant="monoSmall" color="muted" style={styles.message}>
        {message}
      </Text>
      {status === 'error' && (
        <Pressable onPress={() => router.replace('/(tabs)')} style={styles.back}>
          <Text variant="monoSmall" style={{ color: c.text }}>← back to Mneme</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
  message: { marginTop: Spacing[4], textAlign: 'center' },
  back: { marginTop: Spacing[5] },
});
