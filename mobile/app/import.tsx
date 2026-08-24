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
        setError('that file is too big for the phone to hand over. unzip it and pick the file inside you want.');
        return;
      }
      setBusy(true);
      const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const payload: ImportPayload = { content, filename: asset.name, encoding: 'base64' };
      const inspect = await api.importer.inspect(payload);
      if (inspect.withWords + inspect.bare === 0) {
        setError('nothing mneme could read in that. goodreads, letterboxd, kindle, storygraph, imdb, netflix, takeout, notes, bookmarks and most other exports work.');
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
    return parts.length ? parts.join(' · ') : null;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="Import" variant="title" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text variant="monoSmall" color="muted" style={styles.intro}>
          bring a file from anywhere — a goodreads or letterboxd export, kindle clippings, a storygraph or imdb
          list, netflix history, a google takeout, a folder of notes, browser bookmarks. mneme works out what it
          is and files what you wrote on your map.
        </Text>

        {job && (
          <View style={[styles.jobCard, { borderColor: c.border, backgroundColor: c.surface }]}>
            {running ? (
              <>
                <AsciiLoader size={64} message={`mapping ${job.formats[0] ?? 'your file'}… ${progress}/${job.total}`} />
                <Text variant="monoSmall" color="faint" style={styles.jobNote}>
                  safe to leave — this keeps going.
                </Text>
              </>
            ) : (
              <>
                <Text variant="serif">{job.total === 0 ? 'nothing new to map.' : `mapped ${job.done} of ${job.total}.`}</Text>
                {job.formats.length > 0 && (
                  <Text variant="monoSmall" color="faint" style={styles.jobNote}>
                    {job.formats.join(' · ')}
                  </Text>
                )}
                {skippedLine(job) && (
                  <Text variant="monoSmall" color="faint" style={styles.jobNote}>
                    {skippedLine(job)}
                  </Text>
                )}
                {job.done > 0 && (
                  <Button label="view your atlas →" variant="secondary" size="sm" onPress={() => router.replace('/(tabs)' as never)} style={styles.jobAction} />
                )}
              </>
            )}
          </View>
        )}

        {!running && picked && (
          <View style={[styles.jobCard, { borderColor: c.border, backgroundColor: c.surface, alignItems: 'stretch' }]} testID="import-inspect">
            <Text variant="serif">{picked.inspect.formats.join(' · ') || 'a file'}</Text>
            <Text variant="monoSmall" color="muted" style={{ lineHeight: 18 }}>
              {[
                `${picked.inspect.withWords} with your words`,
                picked.inspect.bare > 0 ? `${picked.inspect.bare} without` : null,
                picked.inspect.skippedFiles > 0 ? `${picked.inspect.skippedFiles} files skipped` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {picked.inspect.bare > 0 && (
              <Pressable
                onPress={() => setIncludeBare((v) => !v)}
                style={[styles.toggleRow, { borderColor: c.border }]}
                accessibilityRole="switch"
                accessibilityState={{ checked: includeBare }}
              >
                <Text variant="monoSmall" color="primary" style={{ flex: 1, lineHeight: 18 }}>
                  also bring the {picked.inspect.bare} you didn’t write about — mneme finds a page for each and reads it
                </Text>
                <View style={[styles.toggle, { borderColor: includeBare ? c.text : c.border }]}>
                  <Text variant="monoSmall" color={includeBare ? 'primary' : 'muted'}>
                    {includeBare ? 'on' : 'off'}
                  </Text>
                </View>
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', gap: Spacing[3], marginTop: Spacing[2] }}>
              <Button
                label={busy ? 'starting…' : 'map it'}
                onPress={() => void start({ ...picked.payload, includeBare })}
                loading={busy}
                disabled={busy || picked.inspect.withWords + (includeBare ? picked.inspect.bare : 0) === 0}
                style={{ flex: 1 }}
              />
              <Button label="not this one" variant="tertiary" onPress={() => setPicked(null)} />
            </View>
          </View>
        )}

        {!running && !picked && (
          <>
            <Text variant="label" color="muted" style={styles.sectionHeader}>
              A file
            </Text>
            <Button label={busy ? 'reading…' : 'choose a file'} variant="secondary" onPress={() => void pickFile()} disabled={busy} loading={busy} fullWidth />
            <Text variant="monoSmall" color="faint" style={styles.hint}>
              csv, zip, txt, json, md, html, xml, enex — up to 200 rows map per import; anything already on your map is skipped.
            </Text>

            <Text variant="label" color="muted" style={styles.sectionHeader}>
              Or paste links
            </Text>
            <TextInput
              multiline
              value={text}
              onChangeText={setText}
              placeholder={'https://…\nhttps://…'}
              placeholderTextColor={c.faint}
              style={[styles.textarea, { borderColor: c.border, backgroundColor: c.surface, color: c.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Paste a list of links"
              testID="import-paste"
            />
            <Button label={busy ? 'reading…' : 'map these links'} onPress={() => void start({ content: text })} disabled={busy || text.trim().length === 0} loading={busy} fullWidth style={styles.mapBtn} />

            <Pressable onPress={() => router.push('/connections' as never)} hitSlop={8} accessibilityRole="link">
              <Text variant="monoSmall" color="muted" style={styles.hint}>
                {'have an account instead? connect it and it keeps flowing →'}
              </Text>
            </Pressable>
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
  textarea: { minHeight: 120, maxHeight: 220, borderWidth: 1, borderRadius: Radius.sm, padding: Spacing[4], fontSize: 14, textAlignVertical: 'top' },
  mapBtn: { marginTop: Spacing[3] },
  hint: { marginTop: Spacing[3], lineHeight: 18 },
  jobCard: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing[5], marginBottom: Spacing[2], alignItems: 'center', gap: Spacing[2] },
  jobNote: { textAlign: 'center' },
  jobAction: { marginTop: Spacing[2] },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingVertical: Spacing[3], borderTopWidth: 1, marginTop: Spacing[2] },
  toggle: { borderWidth: 1, borderRadius: Radius.full, paddingVertical: 4, paddingHorizontal: Spacing[3], minWidth: 44, alignItems: 'center' },
  error: { marginTop: Spacing[4], textAlign: 'center' },
});
