import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { FontFamily, LetterSpacing, LineHeight, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { RECAP_ASPECT, SHARE_CTA, nodeIdea, nodeImage, primaryTopic } from '@/lib/recap';
import type { TemplatePalette } from '@/lib/recapTemplates';
import type { CaptureSummary } from '@/types/api';

/**
 * The shareable cards. They take a resolved template palette as a prop (rather
 * than reading the app theme), so the exact same component drives the on-screen
 * preview and the off-screen rasterization — a captured frame is pixel-identical
 * to what the user previewed, in whatever template they picked.
 */

interface CardBase {
  p: TemplatePalette;
  width: number;
  handle: string | null;
}

const KIND_WORD: Record<CaptureSummary['kind'], string> = {
  LINK: 'link',
  TEXT: 'note',
  QUOTE: 'quote',
  IMAGE: 'image',
};

/** The Mono template's minimal flourish — the same blinking cat from loaders. */
const ASCII_CAT = ' /\\_/\\\n( o.o )\n > ^ <';

/**
 * The single brand line a frame carries: wordmark + where to get it, once.
 * The handle rides along only where it's passed (the cover and the poster) —
 * a slideshow should not sign every slide.
 */
function BrandFooter({ p, handle }: { p: TemplatePalette; handle?: string | null }) {
  return (
    <View style={styles.brandRow}>
      <Text variant="monoSmall" style={[styles.cta, { color: p.textSecondary }]} numberOfLines={1}>
        <Text style={[styles.wordmarkSm, { color: p.text }]}>mneme</Text>
        {` · ${SHARE_CTA}`}
      </Text>
      {handle ? (
        <Text variant="monoSmall" style={{ color: p.faint }} numberOfLines={1}>
          @{handle}
        </Text>
      ) : null}
    </View>
  );
}

/* ----------------------------------------------------------------- cover --- */

export function RecapCoverCard({
  p,
  width,
  handle,
  title,
  count,
  dateRange,
}: CardBase & { title: string; count: number; dateRange: string }) {
  const height = width * RECAP_ASPECT;

  return (
    <View style={[styles.card, { width, height, backgroundColor: p.surface, borderColor: p.border }]}>
      {p.barHeight > 0 ? <View style={{ height: p.barHeight, backgroundColor: p.accent }} /> : null}
      <View style={styles.coverBody}>
        <View style={styles.coverCenter}>
          {p.ascii ? <Text style={[styles.ascii, { color: p.faint }]}>{ASCII_CAT}</Text> : null}
          <Text variant="label" style={{ color: p.accent, marginBottom: Spacing[3] }}>
            a recap
          </Text>
          <Text style={[styles.coverTitle, { color: p.titleColor }]} numberOfLines={5}>
            {title}
          </Text>
          <Text variant="mono" style={{ color: p.faint, marginTop: Spacing[4] }}>
            {count} {count === 1 ? 'save' : 'saves'}
            {dateRange ? ` · ${dateRange}` : ''}
          </Text>
        </View>

        <BrandFooter p={p} handle={handle} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ node --- */

export function RecapNodeCard({
  p,
  width,
  item,
  index,
  total,
}: Omit<CardBase, 'handle'> & { item: CaptureSummary; index: number; total: number }) {
  const height = width * RECAP_ASPECT;
  const image = nodeImage(item);
  const topic = primaryTopic(item);
  const idea = nodeIdea(item);
  const source = item.contentItem?.authorName ?? item.contentItem?.sourceName ?? null;
  const bloom = p.id === 'bloom';

  return (
    <View style={[styles.card, { width, height, backgroundColor: p.surface, borderColor: p.border }]}>
      <View style={styles.nodeBody}>
        <Text variant="label" style={{ color: p.accent }} numberOfLines={1}>
          {KIND_WORD[item.kind]}
          {topic ? ` · ${topic}` : ''}
        </Text>

        {image ? (
          <Image
            source={{ uri: image }}
            style={[styles.nodeImage, { borderColor: bloom ? p.accent : p.border }]}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : null}

        {/* Flex middle that clips its own overflow, so a long title/idea can
            never push the footer off the fixed-height card (the cut-off bug).
            Without an image the text centres — top-anchored it strands a
            third of the card as dead space above the footer. */}
        <View style={[styles.nodeMiddle, !image && styles.nodeMiddleCentered]}>
          <Text style={[styles.nodeTitle, { color: p.text }]} numberOfLines={image ? 3 : 4}>
            {item.title}
          </Text>
          {idea ? (
            bloom ? (
              <View style={[styles.ideaPanel, { backgroundColor: p.accentSoft }]}>
                <Text variant="serif" style={[styles.nodeIdea, { color: p.textSecondary }]} numberOfLines={image ? 4 : 7}>
                  {idea}
                </Text>
              </View>
            ) : (
              <Text
                variant="serif"
                style={[styles.nodeIdea, styles.nodeIdeaGap, { color: p.textSecondary }]}
                numberOfLines={image ? 4 : 7}
              >
                {idea}
              </Text>
            )
          ) : null}
        </View>

        <View style={[styles.nodeFooter, { borderTopColor: p.border }]}>
          {source ? (
            <Text variant="monoSmall" style={[styles.nodeSource, { color: p.faint }]} numberOfLines={1}>
              {source}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Text variant="monoSmall" style={{ color: p.accent }}>
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </Text>
        </View>

        <BrandFooter p={p} />
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- poster --- */

/** The whole recap condensed into one tall image — height wraps its content. */
export function RecapPoster({
  p,
  width,
  handle,
  title,
  dateRange,
  items,
}: CardBase & { title: string; dateRange: string; items: CaptureSummary[] }) {
  return (
    <View style={[styles.card, { width, backgroundColor: p.surface, borderColor: p.border }]}>
      {p.barHeight > 0 ? <View style={{ height: p.barHeight, backgroundColor: p.accent }} /> : null}
      <View style={styles.posterBody}>
        {p.ascii ? <Text style={[styles.ascii, styles.posterAscii, { color: p.faint }]}>{ASCII_CAT}</Text> : null}

        <Text style={[styles.posterTitle, { color: p.titleColor }]} numberOfLines={3}>
          {title}
        </Text>
        <Text variant="mono" style={{ color: p.faint, marginTop: Spacing[2] }}>
          {items.length} {items.length === 1 ? 'save' : 'saves'}
          {dateRange ? ` · ${dateRange}` : ''}
        </Text>

        <View style={[styles.posterRule, { backgroundColor: p.border }]} />

        {items.map((item, i) => {
          const topic = primaryTopic(item);
          const image = nodeImage(item);
          const source = item.contentItem?.authorName ?? item.contentItem?.sourceName ?? null;
          return (
            <View
              key={item.id}
              style={[styles.posterRow, i > 0 && { borderTopWidth: 1, borderTopColor: p.border }]}
            >
              <Text variant="monoSmall" style={[styles.posterIndex, { color: p.accent }]}>
                {String(i + 1).padStart(2, '0')}
              </Text>
              <View style={styles.posterRowText}>
                <Text variant="serif" style={{ color: p.text }} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text variant="monoSmall" style={{ color: p.faint, marginTop: 2 }} numberOfLines={1}>
                  {KIND_WORD[item.kind]}
                  {topic ? ` · ${topic}` : ''}
                  {source ? ` · ${source}` : ''}
                </Text>
              </View>
              {image ? (
                <Image
                  source={{ uri: image }}
                  style={[styles.posterThumb, { borderColor: p.border }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : null}
            </View>
          );
        })}

        <View style={styles.posterFooter}>
          <BrandFooter p={p} handle={handle} />
        </View>
      </View>
    </View>
  );
}

const CARD_PAD = Spacing[6];

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  wordmarkSm: {
    fontFamily: FontFamily.serif,
    fontSize: 13,
    letterSpacing: LetterSpacing.wide,
  },
  cta: { flex: 1, marginRight: Spacing[3] },
  ascii: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    lineHeight: 15,
    textAlign: 'center',
    marginBottom: Spacing[5],
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[4],
  },

  coverBody: { flex: 1, padding: CARD_PAD },
  coverCenter: { flex: 1, justifyContent: 'center' },
  coverTitle: {
    fontFamily: FontFamily.serif,
    fontSize: 30,
    lineHeight: 30 * LineHeight.snug,
    letterSpacing: LetterSpacing.tight,
  },

  nodeBody: { flex: 1, padding: CARD_PAD },
  nodeImage: {
    width: '100%',
    height: '30%',
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: Spacing[3],
  },
  nodeMiddle: {
    flex: 1,
    overflow: 'hidden',
    marginTop: Spacing[3],
  },
  nodeMiddleCentered: { justifyContent: 'center' },
  nodeTitle: {
    fontFamily: FontFamily.serif,
    fontSize: 20,
    lineHeight: 20 * LineHeight.snug,
    letterSpacing: LetterSpacing.tight,
  },
  nodeIdea: {
    fontSize: 13.5,
    lineHeight: 13.5 * LineHeight.normal,
  },
  nodeIdeaGap: { marginTop: Spacing[3] },
  ideaPanel: {
    marginTop: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.md,
  },
  nodeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing[3],
    borderTopWidth: 1,
  },
  nodeSource: { flex: 1, marginRight: Spacing[3] },

  posterBody: { padding: CARD_PAD },
  posterAscii: { marginTop: 0, marginBottom: 0, alignSelf: 'center' },
  posterTitle: {
    fontFamily: FontFamily.serif,
    fontSize: 30,
    lineHeight: 30 * LineHeight.tight,
    letterSpacing: LetterSpacing.tight,
    marginTop: Spacing[2],
  },
  posterRule: {
    height: 1,
    width: '100%',
    marginTop: Spacing[5],
  },
  posterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[4],
  },
  posterIndex: { width: 26 },
  posterRowText: { flex: 1, paddingRight: Spacing[3] },
  posterThumb: {
    width: 46,
    height: 46,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  posterFooter: { marginTop: Spacing[4] },
});
