import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { FontFamily, LetterSpacing, LineHeight, Radius, Spacing } from '@/constants/theme';
import type { AppThemeColors } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { RECAP_ASPECT, nodeIdea, nodeImage, primaryTopic } from '@/lib/recap';
import type { CaptureSummary } from '@/types/api';

/**
 * The shareable cards. They are deliberately self-contained and take their
 * palette + accent as props (rather than reading the theme), so the exact same
 * component drives both the on-screen preview and the off-screen rasterization —
 * a captured frame is pixel-identical to what the user previewed.
 */

interface CommonProps {
  colors: AppThemeColors;
  accent: string;
  width: number;
  handle: string | null;
}

const KIND_WORD: Record<CaptureSummary['kind'], string> = {
  LINK: 'link',
  TEXT: 'note',
  QUOTE: 'quote',
  IMAGE: 'image',
};

function BrandFooter({ colors, handle }: { colors: AppThemeColors; handle: string | null }) {
  return (
    <View style={styles.brandRow}>
      <Text style={[styles.wordmarkSm, { color: colors.text }]}>mneme</Text>
      {handle ? (
        <Text variant="monoSmall" style={{ color: colors.faint }} numberOfLines={1}>
          @{handle}
        </Text>
      ) : null}
    </View>
  );
}

/* ----------------------------------------------------------------- cover --- */

export function RecapCoverCard({
  colors,
  accent,
  width,
  handle,
  title,
  count,
  dateRange,
}: CommonProps & { title: string; count: number; dateRange: string }) {
  const height = width * RECAP_ASPECT;

  return (
    <View
      style={[styles.card, { width, height, backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.accentBar, { backgroundColor: accent }]} />
      <View style={styles.coverBody}>
        <View style={styles.headerRow}>
          <Text style={[styles.wordmark, { color: colors.text }]}>mneme</Text>
          {dateRange ? (
            <Text variant="monoSmall" style={{ color: colors.muted }}>
              {dateRange}
            </Text>
          ) : null}
        </View>

        <View style={styles.coverCenter}>
          <Text variant="label" style={{ color: accent, marginBottom: Spacing[3] }}>
            a recap
          </Text>
          <Text style={[styles.coverTitle, { color: colors.text }]} numberOfLines={4}>
            {title}
          </Text>
          <Text variant="mono" style={{ color: colors.muted, marginTop: Spacing[4] }}>
            {count} {count === 1 ? 'save' : 'saves'}
            {dateRange ? ` · ${dateRange}` : ''}
          </Text>
        </View>

        <BrandFooter colors={colors} handle={handle} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ node --- */

export function RecapNodeCard({
  colors,
  accent,
  width,
  handle,
  item,
  index,
  total,
}: CommonProps & { item: CaptureSummary; index: number; total: number }) {
  const height = width * RECAP_ASPECT;
  const image = nodeImage(item);
  const topic = primaryTopic(item);
  const idea = nodeIdea(item);
  const source = item.contentItem?.authorName ?? item.contentItem?.sourceName ?? null;

  return (
    <View
      style={[styles.card, { width, height, backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.nodeBody}>
        <Text variant="label" style={{ color: accent }} numberOfLines={1}>
          {KIND_WORD[item.kind]}
          {topic ? ` · ${topic}` : ''}
        </Text>

        {image ? (
          <Image
            source={{ uri: image }}
            style={[styles.nodeImage, { borderColor: colors.border }]}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
          />
        ) : null}

        <Text
          style={[styles.nodeTitle, { color: colors.text }]}
          numberOfLines={image ? 3 : 4}
        >
          {item.title}
        </Text>

        {idea ? (
          <Text
            variant="serif"
            style={[styles.nodeIdea, { color: colors.textSecondary }]}
            numberOfLines={image ? 3 : 6}
          >
            {idea}
          </Text>
        ) : null}

        <View style={styles.nodeSpacer} />

        <View style={[styles.nodeFooter, { borderTopColor: colors.borderSubtle }]}>
          {source ? (
            <Text variant="monoSmall" style={[styles.nodeSource, { color: colors.faint }]} numberOfLines={1}>
              {source}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Text variant="monoSmall" style={{ color: colors.faint }}>
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </Text>
        </View>

        <BrandFooter colors={colors} handle={handle} />
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- poster --- */

/**
 * The whole recap condensed into a single tall image. Height wraps its content
 * rather than sitting on the 4:5 grid — a poster, not a slide.
 */
export function RecapPoster({
  colors,
  accent,
  width,
  handle,
  title,
  dateRange,
  items,
}: CommonProps & { title: string; dateRange: string; items: CaptureSummary[] }) {
  return (
    <View
      style={[styles.card, styles.poster, { width, backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.accentBar, { backgroundColor: accent }]} />
      <View style={styles.posterBody}>
        <View style={styles.headerRow}>
          <Text style={[styles.wordmark, { color: colors.text }]}>mneme</Text>
          {dateRange ? (
            <Text variant="monoSmall" style={{ color: colors.muted }}>
              {dateRange}
            </Text>
          ) : null}
        </View>

        <Text style={[styles.posterTitle, { color: colors.text }]} numberOfLines={3}>
          {title}
        </Text>
        <Text variant="mono" style={{ color: colors.muted, marginTop: Spacing[2] }}>
          {items.length} {items.length === 1 ? 'save' : 'saves'}
        </Text>

        <View style={[styles.posterRule, { backgroundColor: colors.border }]} />

        {items.map((item, i) => {
          const topic = primaryTopic(item);
          const image = nodeImage(item);
          const source = item.contentItem?.authorName ?? item.contentItem?.sourceName ?? null;
          return (
            <View
              key={item.id}
              style={[styles.posterRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.borderSubtle }]}
            >
              <Text variant="monoSmall" style={[styles.posterIndex, { color: accent }]}>
                {String(i + 1).padStart(2, '0')}
              </Text>
              <View style={styles.posterRowText}>
                <Text variant="serif" style={{ color: colors.text }} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text variant="monoSmall" style={{ color: colors.faint, marginTop: 2 }} numberOfLines={1}>
                  {KIND_WORD[item.kind]}
                  {topic ? ` · ${topic}` : ''}
                  {source ? ` · ${source}` : ''}
                </Text>
              </View>
              {image ? (
                <Image
                  source={{ uri: image }}
                  style={[styles.posterThumb, { borderColor: colors.border }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : null}
            </View>
          );
        })}

        <View style={styles.posterFooter}>
          <BrandFooter colors={colors} handle={handle} />
        </View>
      </View>
    </View>
  );
}

const CARD_PAD = Spacing[7];

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accentBar: {
    height: 6,
    width: '100%',
  },
  wordmark: {
    fontFamily: FontFamily.serif,
    fontSize: 17,
    letterSpacing: LetterSpacing.wider,
  },
  wordmarkSm: {
    fontFamily: FontFamily.serif,
    fontSize: 13,
    letterSpacing: LetterSpacing.wide,
    opacity: 0.75,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[5],
  },

  coverBody: { flex: 1, padding: CARD_PAD },
  coverCenter: { flex: 1, justifyContent: 'center' },
  coverTitle: {
    fontFamily: FontFamily.serif,
    fontSize: 36,
    lineHeight: 36 * LineHeight.tight,
    letterSpacing: LetterSpacing.tight,
  },

  nodeBody: { flex: 1, padding: CARD_PAD },
  nodeImage: {
    width: '100%',
    height: '40%',
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: Spacing[4],
  },
  nodeTitle: {
    fontFamily: FontFamily.serif,
    fontSize: 24,
    lineHeight: 24 * LineHeight.snug,
    letterSpacing: LetterSpacing.tight,
    marginTop: Spacing[4],
  },
  nodeIdea: {
    fontSize: 15,
    lineHeight: 15 * LineHeight.relaxed,
    marginTop: Spacing[3],
  },
  nodeSpacer: { flex: 1, minHeight: Spacing[4] },
  nodeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing[3],
    borderTopWidth: 1,
  },
  nodeSource: { flex: 1, marginRight: Spacing[3] },

  poster: {},
  posterBody: { padding: CARD_PAD },
  posterTitle: {
    fontFamily: FontFamily.serif,
    fontSize: 30,
    lineHeight: 30 * LineHeight.tight,
    letterSpacing: LetterSpacing.tight,
    marginTop: Spacing[6],
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
