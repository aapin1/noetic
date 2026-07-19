import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { FileTextIcon } from 'lucide-react-native';
import { Radius, Spacing } from '@/constants/theme';
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

  return (
    <Pressable onPress={onPress} style={[styles.row, { borderBottomColor: c.border }]} accessibilityRole="button">
      {thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={[styles.thumb, { borderColor: c.border }]} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder, { borderColor: c.border, backgroundColor: c.surface }]}>
          <FileTextIcon size={18} color={c.faint} />
        </View>
      )}

      <View style={styles.info}>
        <Text variant="serif" color="primary" numberOfLines={2}>
          {item.title}
        </Text>
        {!!author && (
          <Text variant="monoSmall" color="faint" numberOfLines={1} style={styles.author}>
            {author}
          </Text>
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
  author: {
    marginTop: Spacing[1],
  },
  date: {
    alignSelf: 'flex-start',
  },
});
