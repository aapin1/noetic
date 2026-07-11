import React, { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeftIcon, ExternalLinkIcon, PencilIcon } from 'lucide-react-native';
import { Image } from 'expo-image';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { InsightLine } from '@/components/InsightLine';
import { EmptyState } from '@/components/ui/EmptyState';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';

export default function InsightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useThemeColors();
  const router = useRouter();

  const { data, loading, error, refetch } = useApiQuery(() => api.captures.get(id), [id]);

  // Editing the AI's understanding of the content. Saving reprocesses the
  // whole capture (embedding, topics, connections, insights), so the screen
  // shows a working state and refetches when done.
  const [editing, setEditing] = useState(false);
  const [contextDraft, setContextDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const startEdit = useCallback((current: string) => {
    setContextDraft(current);
    setEditError('');
    setEditing(true);
  }, []);

  const saveContext = useCallback(async () => {
    const text = contextDraft.trim();
    if (!text) { setEditError('Say a sentence or two about what it was.'); return; }
    setSaving(true);
    setEditError('');
    try {
      await api.captures.updateContext(id, text);
      await refetch();
      setEditing(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }, [contextDraft, id, refetch]);

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.nav, { borderBottomColor: c.border }]}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <ChevronLeftIcon size={22} color={c.text} />
          </Pressable>
        </View>
        <AsciiLoader fill size={96} message={['pulling it from memory…', 'unfolding the insight…']} />
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <EmptyState title="Insight not found" ctaLabel="Back" onCta={() => router.back()} />
      </SafeAreaView>
    );
  }

  const url = data.contentItem?.canonicalUrl ?? null;
  const title = data.title;
  const author = data.contentItem?.authorName ?? null;

  // Normalise for deduplication — ignore case and whitespace
  function norm(s: string | null | undefined) {
    return (s ?? '').trim().toLowerCase();
  }
  const titleN = norm(title);

  // The user's own words (text notes and quotes) are the substance, so show
  // them. Scraped links never show body text here — only title, author,
  // reaction, and insight.
  const showRawText =
    !!data.rawText &&
    (data.kind === 'TEXT' || data.kind === 'QUOTE') &&
    norm(data.rawText) !== titleN;
  const showReaction = !!data.reaction && norm(data.reaction) !== titleN;

  // The AI's understanding of the content — the user's own account wins over
  // the AI summary, and either can be corrected (which reprocesses the
  // capture). We show a short AI-written gist, never the raw scraped body or
  // transcript. Only link/image captures have an AI reading to correct; text
  // and quote captures ARE the user's words already.
  const showAbout = data.kind === 'LINK' || data.kind === 'IMAGE';
  // Legacy captures (saved before summaries existed) have no summary but do
  // have a description. Fall back to it only when it's short — a real excerpt
  // is a sentence or two; a scraped transcript/body is long, so length-gating
  // keeps raw transcriptions from ever leaking through.
  const legacyDescription =
    data.contentItem?.description && data.contentItem.description.length <= 400
      ? data.contentItem.description
      : null;
  const aboutText = data.userContext ?? data.summary ?? legacyDescription;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.nav, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="monoSmall" color="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          insight
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {data.contentItem?.imageUrl ? (
          <Image
            source={{ uri: data.contentItem.imageUrl }}
            style={styles.cover}
            contentFit="cover"
          />
        ) : null}
        {data.mediaUrl && data.kind === 'IMAGE' ? (
          <Image source={{ uri: data.mediaUrl }} style={styles.cover} contentFit="cover" />
        ) : null}

        <View style={styles.block}>
          <View style={styles.badges}>
            <Badge label={data.kind} variant="edge" />
            {[...data.topics]
              // General fields first (filled), then specific topics (outline).
              .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'general' ? -1 : 1))
              .slice(0, 4)
              .map((t) => (
                <Badge
                  key={t.topicId}
                  label={t.name}
                  variant="topic"
                  selected={t.kind === 'general'}
                />
              ))}
          </View>
          <Text variant="h2">{title}</Text>
          {author ? (
            <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[2] }}>
              {author}
            </Text>
          ) : null}
          {url ? (
            <Pressable
              onPress={() => Linking.openURL(url)}
              style={[styles.linkRow, { marginTop: Spacing[4] }]}
              accessibilityRole="link"
            >
              <ExternalLinkIcon size={14} color={c.text} />
              <Text variant="monoSmall" color="primary" style={{ marginLeft: 6 }}>
                Source
              </Text>
            </Pressable>
          ) : null}
          {showRawText ? (
            <Text variant="body" color="secondary" style={{ marginTop: Spacing[5] }}>
              {data.rawText}
            </Text>
          ) : null}
        </View>

        {showAbout ? (
          <View style={styles.section}>
            <View style={styles.aboutHeader}>
              <Text variant="h3">About this capture</Text>
              {!editing && !saving ? (
                <Pressable
                  onPress={() => startEdit(data.userContext ?? aboutText ?? '')}
                  accessibilityLabel="Correct what this capture is about"
                  style={styles.editBtn}
                >
                  <PencilIcon size={14} color={c.muted} />
                </Pressable>
              ) : null}
            </View>
            {saving ? (
              <View style={styles.savingRow}>
                <LoadingDots size={4} />
                <Text variant="monoSmall" color="muted">re-mapping connections…</Text>
              </View>
            ) : editing ? (
              <View style={[styles.editBox, { borderColor: c.border }]}>
                <TextInput
                  style={[styles.editInput, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
                  value={contextDraft}
                  onChangeText={setContextDraft}
                  placeholder="what was this actually about, in your own words?"
                  placeholderTextColor={c.muted}
                  multiline
                  autoFocus
                />
                {!!editError && (
                  <Text variant="monoSmall" color="danger" style={{ marginTop: Spacing[2] }}>{editError}</Text>
                )}
                <View style={styles.editActions}>
                  <VoiceNoteButton
                    onText={(t) => setContextDraft((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))}
                    onError={setEditError}
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing[4] }}>
                    <Pressable onPress={() => setEditing(false)}>
                      <Text variant="monoSmall" color="muted">cancel</Text>
                    </Pressable>
                    <Pressable onPress={() => void saveContext()} style={[styles.saveBtn, { backgroundColor: c.text }]}>
                      <Text variant="monoSmall" style={{ color: c.background }}>save →</Text>
                    </Pressable>
                  </View>
                </View>
                <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[3] }}>
                  saving re-reads this capture and rebuilds its topics, connections, and insight from your words.
                </Text>
              </View>
            ) : (
              <>
                <Text variant="body" color="secondary" style={{ marginTop: Spacing[4] }}>
                  {aboutText ?? "The source couldn't be read. Tell mneme what it was about."}
                </Text>
                {data.userContext ? (
                  <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[2] }}>
                    in your words
                  </Text>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {showReaction ? (
          <View style={styles.section}>
            <Text variant="h3">Your reaction</Text>
            <Text variant="serif" color="secondary" style={{ marginTop: Spacing[4] }}>
              {data.reaction}
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text variant="h3">Insight</Text>
          {data.insights.map((ins) => (
            <InsightLine key={ins.id} insight={ins} />
          ))}
        </View>

        <View style={styles.section}>
          <Text variant="h3">Connected memory</Text>
          {data.related.length === 0 ? (
            <Text variant="body" color="muted" style={{ marginTop: Spacing[2] }}>
              Nothing connected yet. Links appear as you save more.
            </Text>
          ) : (
            data.related.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/insight/${r.id}` as never)}
                style={[styles.rel, { borderColor: c.border }]}
              >
                {r.edgeType ? <Badge label={r.edgeType} variant="edge" small /> : null}
                <Text variant="bodyMedium" style={{ marginTop: Spacing[2] }} numberOfLines={3}>
                  {r.title}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
  },
  back: { padding: Spacing[2] },
  content: { paddingBottom: Spacing[16] },
  cover: { width: '100%', height: 200, backgroundColor: 'transparent' },
  block: { paddingHorizontal: Spacing[6], paddingTop: Spacing[6] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginBottom: Spacing[3] },
  linkRow: { flexDirection: 'row', alignItems: 'center' },
  section: { paddingHorizontal: Spacing[6], marginTop: Spacing[8] },
  aboutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editBtn: { padding: Spacing[2] },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: Spacing[4] },
  editBox: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing[4], marginTop: Spacing[4] },
  editInput: { minHeight: 88, paddingVertical: Spacing[1] },
  editActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing[3] },
  saveBtn: { paddingVertical: Spacing[2], paddingHorizontal: Spacing[4], borderRadius: Radius.xs },
  rel: {
    marginTop: Spacing[4],
    padding: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.md,
  },
});
