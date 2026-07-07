import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FolderTile } from '@/components/archive/FolderTile';
import type { ArchiveFolderSummary } from '@/types/api';

export function FolderGrid({ folders }: { folders: ArchiveFolderSummary[] }) {
  const router = useRouter();

  return (
    <View style={styles.grid}>
      {folders.map((folder) => (
        <FolderTile
          key={folder.topicId}
          folder={folder}
          onPress={() => router.push(`/archive/${folder.topicId}` as never)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
