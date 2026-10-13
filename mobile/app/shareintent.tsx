import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
// SDK 54+ moved the classic readAsStringAsync/EncodingType API to /legacy;
// the new File API stays opt-in. This keeps the base64 read unchanged.
import * as FileSystem from 'expo-file-system/legacy';
import { api } from '@/lib/api';
import { clearSharedCapture, rememberSharedCapture } from '@/lib/lastShared';
import { failureReason, track, type CaptureKind } from '@/lib/analytics';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { LimitNotice } from '@/components/ui/LimitNotice';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { Button } from '@/components/ui/Button';
import { Spacing } from '@/constants/theme';

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
  const [savedLimit, setSavedLimit] = useState<string | null>(null);
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
      // Classified up front so `capture_started` can name a kind. A shared PDF
      // is guessed IMAGE here and resolves to LINK once the server has sniffed
      // it — the success event below uses `res.kind`, which is authoritative.
      const startedKind: CaptureKind = shareIntent.webUrl
        ? 'LINK'
        : shareIntent.files?.length
          ? 'IMAGE'
          : shareIntent.text && URL_RE.test(shareIntent.text.trim())
            ? 'LINK'
            : 'TEXT';
      const startedAt = Date.now();
      track('capture_started', { kind: startedKind, source: 'share_extension' });

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
          // A shared PDF is a document, not an image: capture it as a LINK to
          // the stored file so the server's PDF pipeline reads its actual text
          // (the IMAGE path would send it to a vision model and fail). iOS
          // reports PDFs under several type names, so check the filename too;
          // the upload route also sniffs the bytes as a final guard.
          const isPdf = file.mimeType?.toLowerCase().includes('pdf') || /\.pdf$/i.test(file.path);
          const { mediaUrl } = await api.captures.upload(base64, isPdf ? 'application/pdf' : file.mimeType);
          res = isPdf || /\.pdf($|\?)/i.test(mediaUrl)
            ? await api.captures.create({ kind: 'LINK', url: mediaUrl })
            : await api.captures.create({ kind: 'IMAGE', mediaUrl });
        } else if (shareIntent.text) {
          const trimmed = shareIntent.text.trim();
          res = URL_RE.test(trimmed)
            ? await api.captures.create({ kind: 'LINK', url: trimmed })
            : await api.captures.create({ kind: 'TEXT', text: trimmed });
        } else {
          throw new Error('Nothing to capture from that share.');
        }

        track('capture_succeeded', {
          kind: res.kind,
          source: 'share_extension',
          duration_ms: Date.now() - startedAt,
        });
        resetShareIntent();
        // If they leave without opening the insight (the common share-sheet
        // exit), the map offers it again on the next app open.
        void rememberSharedCapture(res.id);
        setSavedId(res.id);
        setSavedTitle(res.title);
        setSavedLimit(res.usageLimit?.message ?? null);
        setStatus('saved');
      } catch (e) {
        track('capture_failed', {
          kind: startedKind,
          source: 'share_extension',
          duration_ms: Date.now() - startedAt,
          reason: failureReason(e),
        });
        resetShareIntent();
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Could not save that.');
      }
    })();
  }, [isLoading, isAuthenticated, hasShareIntent, shareIntent, resetShareIntent, router]);

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {status === 'working' && (
        <AsciiLoader size={110} message="Reading the page" />
      )}

      {status === 'saved' && (
        <View style={styles.savedWrap}>
          <AsciiLoader idle variant="cat" size={72} />
          <Text variant="h4" style={styles.savedTitle}>
            Saved to your map
          </Text>
          {!!savedTitle && (
            <Text variant="subheadline" color="secondary" numberOfLines={2} style={styles.savedName}>
              {savedTitle}
            </Text>
          )}
          {!!savedLimit && <LimitNotice message={savedLimit} style={{ maxWidth: 300, marginTop: Spacing[3] }} />}
          <Button
            label="See the insight"
            variant="primary"
            style={styles.primaryBtn}
            accessibilityLabel="Open the insight for this capture"
            onPress={() => {
              void clearSharedCapture();
              router.replace(`/insight/${savedId}?from=share` as never);
            }}
          />
          <Button
            label="Done"
            variant="tertiary"
            style={styles.secondaryBtn}
            onPress={() => router.replace('/(tabs)' as never)}
          />
        </View>
      )}

      {status === 'error' && (
        <>
          <Text variant="subheadline" color="danger" style={styles.message}>
            {message}
          </Text>
          <Button label="Back to Mneme" variant="secondary" style={styles.back} onPress={() => router.replace('/(tabs)')} />
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
  primaryBtn: { marginTop: Spacing[8] },
  secondaryBtn: { marginTop: Spacing[3] },
});
