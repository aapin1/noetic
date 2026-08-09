import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from './Text';
import type { CaptureDetail } from '@/types/api';

/**
 * "Move to…" — the correction surface for a wrong filing. Lists the user's
 * existing topics (from the archive read, which already carries counts), plus
 * a free-text "somewhere new". Same Modal shell as InfoModal: scrim, bottom
 * card, fade.
 */
export function TopicPickerModal({
  visible,
  captureId,
  currentTopicIds,
  onClose,
  onMoved,
}: {
  visible: boolean;
  captureId: string | null;
  currentTopicIds: string[];
  onClose: () => void;
  onMoved: (detail: CaptureDetail) => void;
}) {
  const c = useThemeColors();
  const { data } = useApiQuery(() => api.archive.list(), [], {
    cacheKey: 'archive.list',
    skip: !visible,
  });
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async (body: { topicId?: string; topicName?: string }) => {
    if (!captureId || busy) return;
    setBusy(true);
    try {
      const detail = await api.captures.moveTopic(captureId, body);
      setNewName('');
      onMoved(detail);
    } catch (e) {
      Alert.alert('Could not move it', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const folders = (data?.folders ?? []).filter((f) => f.kind !== 'uncategorized');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close topic picker">
        <Pressable
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          onPress={() => {}}
        >
          <Text variant="label" color="muted" style={styles.title}>
            move to…
          </Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {folders.map((folder) => {
              const here = currentTopicIds.includes(folder.topicId);
              return (
                <Pressable
                  key={folder.topicId}
                  onPress={() => void apply({ topicId: folder.topicId })}
                  disabled={busy || here}
                  style={[styles.row, { borderBottomColor: c.borderSubtle, opacity: here ? 0.45 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Move to ${folder.name}`}
                >
                  <Text variant="bodyMedium" numberOfLines={1} style={styles.rowName}>
                    {folder.name.toLowerCase()}
                  </Text>
                  <Text variant="monoSmall" color="faint">
                    {here ? 'here now' : folder.count}
                  </Text>
                </Pressable>
              );
            })}
            {folders.length === 0 && (
              <Text variant="monoSmall" color="faint" style={styles.emptyLine}>
                no topics yet — name one below.
              </Text>
            )}
          </ScrollView>

          <View style={[styles.newRow, { borderTopColor: c.borderSubtle }]}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="somewhere new…"
              placeholderTextColor={c.faint}
              style={[styles.input, { borderColor: c.border, color: c.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={80}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (newName.trim()) void apply({ topicName: newName });
              }}
              accessibilityLabel="Name a new topic"
            />
            <Pressable
              onPress={() => void apply({ topicName: newName })}
              disabled={busy || newName.trim().length === 0}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Move to the new topic"
            >
              <Text variant="monoSmall" color={newName.trim() ? 'primary' : 'faint'}>
                {busy ? 'moving…' : 'move →'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,9,7,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    borderWidth: 1,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing[6],
    maxHeight: '70%',
  },
  title: { marginBottom: Spacing[3] },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[3],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
  },
  rowName: { flex: 1 },
  emptyLine: { paddingVertical: Spacing[4], textAlign: 'center' },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingTop: Spacing[4],
    marginTop: Spacing[2],
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    fontSize: 14,
  },
});
