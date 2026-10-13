import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { api } from '@/lib/api';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionKicker } from '@/components/ui/SectionKicker';
import { Button } from '@/components/ui/Button';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type { ImportInspect, ImportJob, ImportPayload } from '@/types/api';

const POLL_MS = 2500;
/** Base64 in memory on a phone; bigger than this and we ask for the file inside the zip. */
const MAX_BYTES = 30 * 1024 * 1024;

/**
 * Bring a file. Any export works — goodreads, letterboxd, kindle, a takeout,
 * a folder of notes, browser bookmarks, a pasted list of links. The server
 * says what it found; the one question is whether to also bring the rows
 * you didn't write about. Leaving mid-import is fine — the job keeps going.
 */
export default function ImportScreen() {
  const c = useThemeColors();
  const router = useRouter();

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [picked, setPicked] = useState<{ payload: ImportPayload; inspect: ImportInspect } | null>(null);
  const [includeBare, setIncludeBare] = useState(false);

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

  const start = async (payload: ImportPayload) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.importer.start(payload);
      setJob(res.job);
      setText('');
      setPicked(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    setError('');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      if ((asset.size ?? 0) > MAX_BYTES) {
        setError('That file is too big for the phone to hand over. Unzip it and pick the file inside you want.');
        return;
      }
      setBusy(true);
      const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const payload: ImportPayload = { content, filename: asset.name, encoding: 'base64' };
      const inspect = await api.importer.inspect(payload);
      if (inspect.withWords + inspect.bare === 0) {
        setError('Nothing Mneme could read in that. Goodreads, Letterboxd, Kindle, StoryGraph, IMDb, Netflix, Takeout, notes, bookmarks and most other exports work.');
        return;
      }
      setPicked({ payload, inspect });
      // A file that is all activity (netflix, imdb) is pointless without it; a file with reviews leads with them.
      setIncludeBare(inspect.withWords === 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  const progress = job ? Math.min(job.done + job.failed, job.total) : 0;
  const skippedLine = (j: ImportJob): string | null => {
    const parts: string[] = [];
    if (j.duplicates > 0) parts.push(`${j.duplicates} already on your map`);
    if (j.failed > 0) parts.push(`${j.failed} couldn't be read`);
    if (j.unresolved > 0) parts.push(`${j.unresolved} couldn't be found anywhere`);
    if (j.invalid > 0) parts.push(`${j.invalid} weren't links`);
    if (j.overCap > 0) parts.push(`${j.overCap} over the 200-per-import cap`);
    return parts.length ? parts.join(', ') : null;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="Import" variant="title" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text variant="subheadline" color="secondary" style={styles.intro}>
          Bring a file from anywhere: a Goodreads or Letterboxd export, Kindle clippings, a StoryGraph or IMDb
          list, Netflix history, a Google Takeout, a folder of notes, browser bookmarks. Mneme works out what it
          is and files what you wrote on your map.
        </Text>

        {job && (
          <View style={[styles.jobCard, { borderColor: c.border, backgroundColor: c.surface }]}>
            {running ? (
              <>
                <AsciiLoader size={64} message={`Mapping ${job.formats[0] ?? 'your file'}, ${progress} of ${job.total}`} />
                <Text variant="caption" color="faint" style={styles.jobNote}>
                  Safe to leave. This keeps going.
                </Text>
              </>
            ) : (
              <>
                <Text variant="serif">{job.total === 0 ? 'Nothing new to map.' : `Mapped ${job.done} of ${job.total}.`}</Text>
                {job.formats.length > 0 && (
                  <Text variant="caption" color="faint" style={styles.jobNote}>
                    {job.formats.join(', ')}
                  </Text>
                )}
                {skippedLine(job) && (
                  <Text variant="caption" color="faint" style={styles.jobNote}>
                    {skippedLine(job)}
                  </Text>
                )}
                {job.done > 0 && (
                  <Button label="View your atlas" variant="secondary" size="sm" onPress={() => router.replace('/(tabs)' as never)} style={styles.jobAction} />
                )}
              </>
            )}
          </View>
        )}

        {!running && picked && (
          <View style={[styles.jobCard, { borderColor: c.border, backgroundColor: c.surface, alignItems: 'stretch' }]} testID="import-inspect">
            <Text variant="serif">{picked.inspect.formats.join(', ') || 'A file'}</Text>
            <Text variant="caption" color="muted">
              {[
                `${picked.inspect.withWords} with your words`,
                picked.inspect.bare > 0 ? `${picked.inspect.bare} without` : null,
                picked.inspect.skippedFiles > 0 ? `${picked.inspect.skippedFiles} files skipped` : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </Text>
            {picked.inspect.bare > 0 && (
              <Pressable
                onPress={() => setIncludeBare((v) => !v)}
                style={[styles.toggleRow, { borderColor: c.border }]}
                accessibilityRole="switch"
                accessibilityState={{ checked: includeBare }}
              >
                <Text variant="caption" color="primary" style={{ flex: 1 }}>
                  Also bring the {picked.inspect.bare} you didn't write about. Mneme finds a page for each and reads it.
                </Text>
                <View style={[styles.toggle, { borderColor: includeBare ? c.text : c.border }]}>
                  <Text variant="caption" color={includeBare ? 'primary' : 'muted'}>
                    {includeBare ? 'On' : 'Off'}
                  </Text>
                </View>
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[2] }}>
              <Button
                label={busy ? 'Starting' : 'Map it'}
                onPress={() => void start({ ...picked.payload, includeBare })}
                loading={busy}
                disabled={busy || picked.inspect.withWords + (includeBare ? picked.inspect.bare : 0) === 0}
                style={{ flex: 1 }}
              />
              <Button label="Not this one" variant="tertiary" onPress={() => setPicked(null)} />
            </View>
          </View>
        )}

        {!running && !picked && (
          <>
            <SectionKicker label="A file" style={styles.sectionHeader} />
            <Button label={busy ? 'Reading' : 'Choose a file'} variant="secondary" onPress={() => void pickFile()} disabled={busy} loading={busy} fullWidth />
            <Text variant="caption" color="faint" style={styles.hint}>
              CSV, ZIP, TXT, JSON, MD, HTML, XML or ENEX. Up to 200 rows map per import; anything already on your map is skipped.
            </Text>

            <SectionKicker label="Paste links" style={styles.sectionHeader} />
            <TextInput
              multiline
              value={text}
              onChangeText={setText}
              placeholder="One link per line"
              placeholderTextColor={c.faint}
              style={[styles.textarea, { borderColor: c.border, backgroundColor: c.surface, color: c.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Paste a list of links"
              testID="import-paste"
            />
            <Button label={busy ? 'Reading' : 'Map these links'} onPress={() => void start({ content: text })} disabled={busy || text.trim().length === 0} loading={busy} fullWidth style={styles.mapBtn} />

            <Button label="Connect an account instead" variant="tertiary" onPress={() => router.push('/connections' as never)} fullWidth style={styles.hint} />
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
  intro: { marginBottom: Spacing[4] },
  sectionHeader: { marginTop: Spacing[5], marginBottom: Spacing[2] },
  textarea: { minHeight: 120, maxHeight: 220, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sm, padding: Spacing[4], fontSize: 17, textAlignVertical: 'top' },
  mapBtn: { marginTop: Spacing[3] },
  hint: { marginTop: Spacing[3] },
  jobCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.lg, padding: Spacing[5], marginBottom: Spacing[2], alignItems: 'center', gap: Spacing[2] },
  jobNote: { textAlign: 'center' },
  jobAction: { marginTop: Spacing[2] },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[3], borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing[2] },
  toggle: { borderWidth: 1, borderRadius: Radius.full, paddingVertical: 4, paddingHorizontal: Spacing[3], minWidth: 44, alignItems: 'center' },
  error: { marginTop: Spacing[4], textAlign: 'center' },
});
