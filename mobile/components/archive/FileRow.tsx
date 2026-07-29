import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { FileTextIcon } from 'lucide-react-native';
import { Radius, Spacing, accentForKey } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { CaptureSummary } from '@/types/api';

const THUMB_SIZE = 44;

export function FileRow({ item, onPress }: { item: CaptureSummary; onPress: () => void }) {
  const c = useThemeColors();
  const date = new Date(item.capturedAt);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const thumbUrl = item.kind === 'IMAGE' ? item.mediaUrl : item.contentItem?.imageUrl;
  const author = item.contentItem?.authorName ?? item.contentItem?.sourceName ?? null;
  // The capture's own region, in the region's colour — the same dot-then-name
  // mark the Atlas puts beside a cluster. A list of forty rows had nothing on
  // it but two greys, and this is the cheapest thing that gives the eye a
  // second axis to sort by without adding a column.
  const topic = item.topics[0] ?? null;
  const accent = topic ? accentForKey(topic.topicId) : null;

  return (
    <Pressable onPress={onPress} style={[styles.row, { borderBottomColor: c.border }]} accessibilityRole="button">
      {thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={[styles.thumb, { borderColor: c.border }]} contentFit="cover" />
      ) : (
        <View
          style={[
            styles.thumb,
            styles.thumbPlaceholder,
            { borderColor: c.border, backgroundColor: accent ? `${accent}1F` : c.surface },
          ]}
        >
          <FileTextIcon size={18} color={accent ?? c.faint} />
        </View>
      )}

      <View style={styles.info}>
        <Text variant="serif" color="primary" numberOfLines={2}>
          {item.title}
        </Text>
        {(!!author || !!topic) && (
          <View style={styles.meta}>
            {!!accent && <View style={[styles.topicDot, { backgroundColor: accent }]} />}
            <Text variant="monoSmall" color="faint" numberOfLines={1} style={styles.metaText}>
              {author ?? topic!.name.toLowerCase()}
            </Text>
          </View>
        )}
      </View>

      <Text variant="monoSmall" color="faint" style={styles.date}>
        {dateStr}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    marginHorizontal: Spacing[4],
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing[1],
  },
  topicDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: Spacing[2],
  },
  metaText: { flex: 1 },
  date: {
    alignSelf: 'flex-start',
  },
});
