import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { FolderIcon } from '@/components/archive/FolderIcon';
import type { ArchiveFolderSummary } from '@/types/api';

export function FolderTile({ folder, onPress }: { folder: ArchiveFolderSummary; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tile} accessibilityRole="button" accessibilityLabel={folder.name}>
      <View style={styles.iconWrap}>
        <FolderIcon size={56} />
        <View style={styles.countBadge}>
          <Badge label={String(folder.count)} variant="count" selected small />
        </View>
      </View>
      <Text variant="label" color="secondary" numberOfLines={1} style={styles.name}>
        {folder.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[1],
  },
  iconWrap: {
    position: 'relative',
  },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
  },
  name: {
    marginTop: Spacing[2],
    textAlign: 'center',
  },
});
