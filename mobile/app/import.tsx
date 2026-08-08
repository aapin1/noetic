import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { api } from '@/lib/api';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type { ImportJob } from '@/types/api';

const POLL_MS = 2500;

/**
 * Bulk entry for a saved-links history: paste a list, or hand over a
 * browser-bookmarks HTML / Pocket CSV file. Parsing happens server-side; this
 * screen just ships text and then watches the job. Leaving mid-import is
 * fine — the job keeps mapping and this screen picks the tally back up.
 */
export default function ImportScreen() {
  const c = useThemeColors();
  const router = useRouter();

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);

  // On mount, adopt whatever job is already running (or last finished) so
  // returning to the screen resumes the progress view.
  useEffect(() => {
    void api.importer
      .status()
      .then((res) => setJob(res.job))
      .catch(() => {});
  }, []);

  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void api.importer
        .status()
        .then((res) => {
          if (res.job) setJob(res.job);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  const start = async (content: string, filename?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.importer.start(content, filename);
      setJob(res.job);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/html', 'text/csv', 'text/comma-separated-values', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const content = await FileSystem.readAsStringAsync(asset.uri);
      await start(content, asset.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const progress = job ? Math.min(job.done + job.failed, job.total) : 0;
  const skippedLine = (j: ImportJob): string | null => {
    const parts: string[] = [];
    if (j.duplicates > 0) parts.push(`${j.duplicates} already on your map`);
    if (j.failed > 0) parts.push(`${j.failed} couldn't be read`);
    if (j.invalid > 0) parts.push(`${j.invalid} weren't links`);
    if (j.overCap > 0) parts.push(`${j.overCap} over the 200-per-import cap`);
    return parts.length ? parts.join(' · ') : null;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="Import" variant="title" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text variant="monoSmall" color="muted" style={styles.intro}>
          bring your saved-links history — browser bookmarks, a pocket export, or any pasted list
          of urls. mneme reads each one and files it on your map.
        </Text>

        {job && (
          <View style={[styles.jobCard, { borderColor: c.border, backgroundColor: c.surface }]}>
            {running ? (
              <>
                <AsciiLoader size={64} message={`mapping your library… ${progress}/${job.total}`} />
                <Text variant="monoSmall" color="faint" style={styles.jobNote}>
                  safe to leave — this keeps going.
                </Text>
              </>
            ) : (
              <>
                <Text variant="serif">
                  {job.total === 0 ? 'nothing new to map.' : `mapped ${job.done} of ${job.total}.`}
                </Text>
                {skippedLine(job) && (
                  <Text variant="monoSmall" color="faint" style={styles.jobNote}>
                    {skippedLine(job)}
                  </Text>
                )}
                {job.done > 0 && (
                  <Button
                    label="view your atlas →"
                    variant="secondary"
                    size="sm"
                    onPress={() => router.replace('/(tabs)' as never)}
                    style={styles.jobAction}
                  />
                )}
              </>
            )}
          </View>
        )}

        {!running && (
          <>
            <Text variant="label" color="muted" style={styles.sectionHeader}>
              Paste links
            </Text>
            <TextInput
              multiline
              value={text}
              onChangeText={setText}
              placeholder={'https://…\nhttps://…'}
              placeholderTextColor={c.faint}
              style={[
                styles.textarea,
                { borderColor: c.border, backgroundColor: c.surface, color: c.text },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Paste a list of links"
              testID="import-paste"
            />
            <Button
              label={busy ? 'reading…' : 'map these links'}
              onPress={() => void start(text)}
              disabled={busy || text.trim().length === 0}
              loading={busy}
              fullWidth
              style={styles.mapBtn}
            />

            <Text variant="label" color="muted" style={styles.sectionHeader}>
              Or a file
            </Text>
            <Button
              label="choose a file"
              variant="secondary"
              onPress={() => void pickFile()}
              disabled={busy}
              fullWidth
            />
            <Text variant="monoSmall" color="faint" style={styles.hint}>
              bookmarks exported from a browser (.html) or pocket (.csv). up to 200 links per
              import; anything already on your map is skipped.
            </Text>
          </>
        )}

        {error ? (
          <Text variant="caption" color="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing[6], paddingBottom: Spacing[12], gap: Spacing[2] },
  intro: { lineHeight: 20, marginBottom: Spacing[4] },
  sectionHeader: { marginTop: Spacing[5], marginBottom: Spacing[2] },
  textarea: {
    minHeight: 120,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing[4],
    fontSize: 14,
    textAlignVertical: 'top',
  },
  mapBtn: { marginTop: Spacing[3] },
  hint: { marginTop: Spacing[3], lineHeight: 18 },
  jobCard: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    marginBottom: Spacing[2],
    alignItems: 'center',
    gap: Spacing[2],
  },
  jobNote: { textAlign: 'center' },
  jobAction: { marginTop: Spacing[2] },
  error: { marginTop: Spacing[4], textAlign: 'center' },
});
