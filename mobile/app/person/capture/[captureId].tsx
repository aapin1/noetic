import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeftIcon, ExternalLinkIcon } from 'lucide-react-native';
import { Image } from 'expo-image';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing, accentForKey } from '@/constants/theme';
import { shortDate } from '@/lib/dates';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { SectionKicker } from '@/components/ui/SectionKicker';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type { CaptureKind } from '@/types/api';

const KIND_LABELS: Record<CaptureKind, string> = {
  LINK: 'Link',
  TEXT: 'Note',
  QUOTE: 'Quote',
  IMAGE: 'Image',
};

/**
 * Someone else's capture, opened from their profile. The same page as your own
 * insight, minus everything that is theirs rather than the thing's: no
 * reaction, no "about this capture" note, no readings, no editing. What's left
 * is the cover, the title and byline, the source's own excerpt or the quoted
 * text, the topics it sits in, and the way out to the original.
 */
export default function PersonCaptureScreen() {
  const { captureId, userId, handle } = useLocalSearchParams<{
    captureId: string;
    userId: string;
    handle?: string;
  }>();
  const c = useThemeColors();
  const router = useRouter();

  const { data, loading } = useApiQuery(
    () => api.social.personCapture(userId, captureId),
    [userId, captureId],
    { cacheKey: `social.person.capture:${captureId}` },
  );

  const nav = (
    <View style={[styles.nav, { borderBottomColor: c.deepBorder, backgroundColor: c.deep }]}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Back" hitSlop={8}>
        <ChevronLeftIcon size={22} color={c.deepInk} />
      </Pressable>
      <Text variant="headline" numberOfLines={1} style={[styles.navTitle, { color: c.deepInk }]}>
        {handle ? `@${handle}` : 'Capture'}
      </Text>
      <View style={styles.navSpacer} />
    </View>
  );

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
        {nav}
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <AsciiLoader fill size={96} message="Loading…" />
        </View>
      </SafeAreaView>
    );
  }

  // Unfollowed, blocked or deleted since the list loaded: all the same 404.
  if (!data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
        {nav}
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <EmptyState title="Capture not found" ctaLabel="Back" onCta={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const byline = [data.author, data.source].filter(Boolean).join(', ');
  const url = data.url;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.deep }]} edges={['top']}>
      {nav}
      <ScrollView
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {data.imageUrl ? (
          <Image source={{ uri: data.imageUrl }} style={styles.cover} contentFit="cover" />
        ) : null}

        <View style={styles.block}>
          <View style={styles.badges}>
            <Badge label={KIND_LABELS[data.kind] ?? 'Note'} variant="edge" />
            {[...data.topics]
              // General fields first (filled), then specific topics (outline).
              .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'general' ? -1 : 1))
              .slice(0, 4)
              .map((t) => (
                <Badge
                  key={t.id}
                  label={t.name}
                  variant="topic"
                  accent={accentForKey(t.id)}
                  selected={t.kind === 'general'}
                />
              ))}
          </View>

          <Text variant="h2">{data.title}</Text>
          {!!byline && (
            <Text variant="subheadline" color="secondary" style={{ marginTop: Spacing[2] }}>
              {byline}
            </Text>
          )}
          <Text variant="caption" color="muted" style={{ marginTop: Spacing[2] }}>
            {handle ? `Saved by @${handle}, ${shortDate(data.capturedAt)}` : `Saved ${shortDate(data.capturedAt)}`}
          </Text>

          {data.quote ? (
            <Text variant="body" color="secondary" style={{ marginTop: Spacing[5] }}>
              {data.quote}
            </Text>
          ) : null}

          {url ? (
            <Button
              label="Open link"
              variant="secondary"
              fullWidth
              leftIcon={<ExternalLinkIcon size={16} color={c.text} />}
              onPress={() => void Linking.openURL(url)}
              style={styles.openBtn}
            />
          ) : null}
        </View>

        {data.excerpt ? (
          <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>
            <SectionKicker label="About this" />
            <Text variant="body" color="secondary" style={{ marginTop: Spacing[4] }}>
              {data.excerpt}
            </Text>
          </View>
        ) : null}
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
  back: { padding: Spacing[2], minWidth: 44, minHeight: 44, justifyContent: 'center' },
  navTitle: { flex: 1, textAlign: 'center' },
  navSpacer: { width: 44 },
  content: { paddingBottom: Spacing[16] },
  cover: { width: '100%', height: 200, backgroundColor: 'transparent' },
  block: { paddingHorizontal: Spacing[6], paddingTop: Spacing[6] },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing[2],
    marginBottom: Spacing[3],
  },
  openBtn: { marginTop: Spacing[5] },
  section: {
    marginHorizontal: Spacing[4],
    marginTop: Spacing[5],
    padding: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
});
