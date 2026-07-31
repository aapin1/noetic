import React, { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, PencilIcon } from 'lucide-react-native';
import { Image } from 'expo-image';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Accents, FontFamily, FontSize, Radius, Spacing, accentForKey } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { SectionKicker } from '@/components/ui/SectionKicker';
import { Badge } from '@/components/ui/Badge';
import { InsightLine } from '@/components/InsightLine';
import { EmptyState } from '@/components/ui/EmptyState';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { VoiceNoteButton } from '@/components/ui/VoiceNoteButton';
import { SponsoredCard } from '@/components/ui/SponsoredCard';
import { asInsightSource, track } from '@/lib/analytics';

/**
 * One block of the read: a kicker, a heading, and its body, on card stock.
 *
 * The page used to be four `h3`s and their paragraphs stacked on a bare
 * background with nothing but vertical space between them, which gave the eye
 * no way to tell where one part ended and the next began — it read as one
 * undifferentiated column. The kicker is the app's mono `label` in the
 * section's own accent, matched by a short tick beside it: the same
 * colour-plus-mark grammar the Atlas uses for a region and the archive for a
 * topic, so nothing new has to be learned to read it.
 */
function Section({
  kicker, title, accent, right, children,
}: {
  kicker: string;
  title: string;
  accent: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.sectionHead}>
        <SectionKicker label={kicker} accent={accent} />
        {right}
      </View>
      <Text variant="h3" style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function InsightDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const c = useThemeColors();
  const router = useRouter();

  // Keyed on id, not on mount: this screen re-renders as the capture's drafts
  // stream in, and an open is one event.
  useEffect(() => {
    track('insight_opened', { source: asInsightSource(from) });
    // `from` is fixed for a given navigation, so it is deliberately not a
    // dependency — re-reading the same insight is not a second open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const { data, loading, refetch } = useApiQuery(() => api.captures.get(id), [id], {
    cacheKey: `capture:${id}`,
  });

  // A freshly committed capture arrives with draft insights; the server
  // polishes them in the background within a few seconds. Quietly re-read so
  // the sharpened text swaps in — old captures skip this entirely.
  const capturedAtMs = data ? new Date(data.capturedAt).getTime() : null;
  useEffect(() => {
    if (!capturedAtMs || Date.now() - capturedAtMs > 2 * 60 * 1000) return;
    const first = setTimeout(() => void refetch(), 4000);
    const second = setTimeout(() => void refetch(), 10000);
    return () => { clearTimeout(first); clearTimeout(second); };
  }, [capturedAtMs, refetch]);

  // Editing the AI's understanding of the content. Saving reprocesses the
  // whole capture (embedding, topics, connections, insights), so the screen
  // shows a working state and refetches when done.
  const [editing, setEditing] = useState(false);
  const [contextDraft, setContextDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  // Whether opening the editor should grab focus (pop the keyboard). True for
  // an explicit tap on the pencil; false when the editor auto-opens below so
  // the box just sits there until the user taps in to start typing.
  const [focusEdit, setFocusEdit] = useState(false);

  const startEdit = useCallback((current: string, focus = true) => {
    setContextDraft(current);
    setEditError('');
    setFocusEdit(focus);
    setEditing(true);
  }, []);

  // If nothing could be extracted from the source (no AI summary, no legacy
  // description, and the user hasn't already given their own account), open
  // the "what was this about?" editor immediately instead of leaving it as a
  // quiet line the user has to notice a pencil icon to act on — this is the
  // capture-time fail-safe's prompt, just moved here since capture no longer
  // blocks on it. Guarded per capture id so cancelling doesn't reopen it.
  const autoPromptedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data || (data.kind !== 'LINK' && data.kind !== 'IMAGE')) return;
    // A stub row (scrape failed entirely — paywall, robot wall, dead page)
    // carries the URL itself as its description, so a URL-shaped description
    // is "nothing extracted", not an excerpt. Same test the server applies
    // when deriving the capture summary.
    const desc = data.contentItem?.description?.trim() ?? '';
    const legacyDesc =
      desc.length > 0 && desc.length <= 400 && !/^https?:\/\//i.test(desc) ? desc : null;
    const hasAbout = !!(data.userContext?.trim() || data.summary?.trim() || legacyDesc);
    if (hasAbout || autoPromptedForRef.current === data.id) return;
    autoPromptedForRef.current = data.id;
    // Defer past the push transition: VoiceNoteButton mounts a real
    // `useAudioRecorder` (constructs a native AudioRecorder), and opening
    // straight into that mid-navigation is what crashed ("Calling the ...
    // function has failed") when this screen is reached fresh off a capture.
    // Landing on the editor a beat after the screen settles reads the same
    // to the user but keeps native module setup off the transition.
    const task = InteractionManager.runAfterInteractions(() => startEdit('', false));
    return () => task.cancel();
  }, [data, startEdit]);

  const saveContext = useCallback(async () => {
    const text = contextDraft.trim();
    if (!text) { setEditError('Say a sentence or two about what it was.'); return; }
    setSaving(true);
    setEditError('');
    try {
      await api.captures.updateContext(id, text);
      await refetch();
      setEditing(false);
      // The reprocess returns draft insights and polishes them in the
      // background (like a fresh capture) — quietly re-read so the sharpened
      // text swaps in. The young-capture timers above don't cover edits of
      // older captures.
      setTimeout(() => void refetch(), 4000);
      setTimeout(() => void refetch(), 10000);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }, [contextDraft, id, refetch]);

  // Renaming the capture — cosmetic, instant, never reruns the pipeline.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const saveTitle = useCallback(async () => {
    const text = titleDraft.trim();
    if (!text) { setEditingTitle(false); return; }
    setSavingTitle(true);
    try {
      await api.captures.updateTitle(id, text);
      await refetch();
      setEditingTitle(false);
    } catch {
      // keep the editor open so nothing typed is lost
    } finally {
      setSavingTitle(false);
    }
  }, [titleDraft, id, refetch]);

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
        <View style={[styles.nav, { borderBottomColor: c.deepBorder, backgroundColor: c.deep }]}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <ChevronLeftIcon size={22} color={c.deepInk} />
          </Pressable>
        </View>
        {/* The loader gets the page tone, not the band's. */}
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <AsciiLoader fill size={96} message={['pulling it from memory…', 'unfolding the insight…']} />
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
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
  // A URL-shaped description is a stub from a failed scrape (paywall/robot
  // wall) — never show the link itself as "what this is about".
  const trimmedDescription = data.contentItem?.description?.trim() ?? '';
  const legacyDescription =
    trimmedDescription.length > 0 && trimmedDescription.length <= 400
      && !/^https?:\/\//i.test(trimmedDescription)
      ? trimmedDescription
      : null;
  // Nullish-only fallthrough (??) would keep an empty string in place instead
  // of falling through — treat blank strings as "nothing extracted" too.
  const aboutText = data.userContext?.trim() || data.summary?.trim() || legacyDescription || null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
      {/* Same dark chrome band as every tab's header, so a detail page reads
          as part of the app rather than as a plain sheet with a back arrow. */}
      <View style={[styles.nav, { borderBottomColor: c.deepBorder, backgroundColor: c.deep }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.deepInk} />
        </Pressable>
        <Text variant="monoSmall" numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: c.deepInkMuted }}>
          insight
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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
                  accent={accentForKey(t.topicId)}
                  selected={t.kind === 'general'}
                />
              ))}
          </View>
          {editingTitle ? (
            <View>
              <TextInput
                style={[styles.titleInput, { color: c.text, borderColor: c.border }]}
                value={titleDraft}
                onChangeText={setTitleDraft}
                autoFocus
                multiline
                editable={!savingTitle}
                onSubmitEditing={() => void saveTitle()}
              />
              <View style={styles.titleActions}>
                <Pressable onPress={() => setEditingTitle(false)} disabled={savingTitle}>
                  <Text variant="monoSmall" color="muted">cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void saveTitle()}
                  disabled={savingTitle}
                  style={[styles.saveBtn, { backgroundColor: c.text, opacity: savingTitle ? 0.5 : 1 }]}
                >
                  <Text variant="monoSmall" style={{ color: c.background }}>
                    {savingTitle ? 'saving…' : 'save →'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.titleRow}>
              <Text variant="h2" style={{ flex: 1 }}>{title}</Text>
              <Pressable
                onPress={() => { setTitleDraft(title); setEditingTitle(true); }}
                accessibilityLabel="Rename this capture"
                style={styles.editBtn}
                hitSlop={6}
              >
                <PencilIcon size={14} color={c.muted} />
              </Pressable>
            </View>
          )}
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
          <Section
            kicker="context"
            title="About this capture"
            accent={Accents.slate}
            right={!editing && !saving ? (
              <Pressable
                onPress={() => startEdit(data.userContext ?? aboutText ?? '')}
                accessibilityLabel="Correct what this capture is about"
                style={styles.editBtn}
              >
                <PencilIcon size={14} color={c.muted} />
              </Pressable>
            ) : null}
          >
            {saving ? (
              <View style={styles.savingRow}>
                <LoadingDots size={4} />
                <Text variant="monoSmall" color="muted">re-mapping connections…</Text>
              </View>
            ) : editing ? (
              <View style={[styles.editBox, { borderColor: c.border }]}>
                {!aboutText && (
                  <Text variant="monoSmall" color="muted" style={{ marginBottom: Spacing[3] }}>
                    We couldn't understand this source — nothing readable came through. Tell mneme what it was about, by typing or speaking.
                  </Text>
                )}
                <TextInput
                  style={[styles.editInput, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.base }]}
                  value={contextDraft}
                  onChangeText={setContextDraft}
                  placeholder="what was this actually about, in your own words?"
                  placeholderTextColor={c.muted}
                  multiline
                  autoFocus={focusEdit}
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
                    <Pressable onPress={() => { setEditing(false); setEditError(''); }}>
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
          </Section>
        ) : null}

        {showReaction ? (
          <Section kicker="you said" title="Your reaction" accent={Accents.clay}>
            <Text variant="body" color="secondary" style={{ marginTop: Spacing[4] }}>
              {data.reaction}
            </Text>
          </Section>
        ) : null}

        <Section kicker="what it means" title="Insight" accent={Accents.amber}>
          {data.insights.map((ins) => (
            <InsightLine key={ins.id} insight={ins} />
          ))}
        </Section>

        {/* Between the read and the onward links, not after everything: at the
            very bottom it sat below the last tappable row and was never seen. */}
        <SponsoredCard />

        <Section kicker="nearby" title="Connected memory" accent={Accents.moss}>
          {data.related.length === 0 ? (
            <Text variant="body" color="muted" style={{ marginTop: Spacing[4] }}>
              Nothing connected yet. Links appear as you save more.
            </Text>
          ) : (
            data.related.map((r) => {
              // Each link carries its own region's colour and name, so the list
              // says WHAT it connects to and not merely that it connects. These
              // were unfilled boxes holding a title and an edge-type chip.
              const relTopic = r.topics[0] ?? null;
              const relAccent = relTopic ? accentForKey(relTopic.topicId) : null;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => router.push(`/insight/${r.id}` as never)}
                  style={[styles.rel, { borderColor: c.border, backgroundColor: c.elevated }]}
                >
                  <View style={styles.relBody}>
                    <Text variant="bodyMedium" numberOfLines={3}>{r.title}</Text>
                    <View style={styles.relMeta}>
                      {!!relAccent && <View style={[styles.relDot, { backgroundColor: relAccent }]} />}
                      <Text variant="monoSmall" color="faint" numberOfLines={1} style={{ flex: 1 }}>
                        {relTopic ? relTopic.name.toLowerCase() : 'linked'}
                      </Text>
                      {r.edgeType ? <Badge label={r.edgeType} variant="edge" small /> : null}
                    </View>
                  </View>
                  <ChevronRightIcon size={16} color={c.faint} />
                </Pressable>
              );
            })
          )}
        </Section>
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
  section: {
    marginHorizontal: Spacing[4],
    marginTop: Spacing[5],
    padding: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
  },
  sectionTitle: { marginTop: Spacing[2] },
  aboutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editBtn: { padding: Spacing[2] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[2] },
  titleInput: {
    fontFamily: FontFamily.serif,
    fontSize: FontSize['2xl'],
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing[3],
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing[4],
    marginTop: Spacing[3],
  },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: Spacing[4] },
  editBox: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing[4], marginTop: Spacing[4] },
  editInput: { minHeight: 88, paddingVertical: Spacing[1] },
  editActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing[3] },
  saveBtn: { paddingVertical: Spacing[2], paddingHorizontal: Spacing[4], borderRadius: Radius.xs },
  rel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing[3],
    padding: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.md,
    gap: Spacing[3],
  },
  relBody: { flex: 1 },
  relMeta: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing[2] },
  relDot: { width: 6, height: 6, borderRadius: 3, marginRight: Spacing[2] },
});
