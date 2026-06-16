import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { PositionChallengeItem } from '@/types/api';

function ChallengeCard({
  challenge,
  onAcknowledge,
}: {
  challenge: PositionChallengeItem;
  onAcknowledge: (challengeId: string, revision?: string) => void;
}) {
  const c = useThemeColors();
  const [revising, setRevising] = useState(false);
  const [revisionText, setRevisionText] = useState('');

  const captureTitle =
    challenge.capturedItem?.contentItem?.title ??
    challenge.capturedItem?.rawText?.slice(0, 80) ??
    'Untitled capture';

  if (challenge.acknowledged) {
    return (
      <View style={[styles.challengeCard, { borderColor: c.borderSubtle, opacity: 0.5 }]}>
        <Text variant="monoSmall" color="muted">{captureTitle}</Text>
        <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[2] }}>
          {challenge.revised ? 'Position revised' : 'Noted'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.challengeCard, { borderColor: c.border }]}>
      <Text variant="monoSmall" color="muted" style={styles.challengeSource}>
        {captureTitle}
      </Text>
      <Text variant="body" color="secondary" style={styles.tensionText}>
        {challenge.tension}
      </Text>
      {revising ? (
        <View style={styles.revisionBlock}>
          <TextInput
            style={[styles.revisionInput, { color: c.text, borderColor: c.borderSubtle }]}
            placeholder="Revise your position…"
            placeholderTextColor={c.faint}
            value={revisionText}
            onChangeText={setRevisionText}
            multiline
            textAlignVertical="top"
            autoFocus
          />
          <View style={styles.revisionActions}>
            <Pressable onPress={() => setRevising(false)}>
              <Text variant="monoSmall" color="muted">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onAcknowledge(challenge.id, revisionText)}
              disabled={revisionText.trim().length < 10}
            >
              <Text variant="monoSmall" color={revisionText.trim().length >= 10 ? 'accent' : 'muted'}>
                Save revision
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.challengeActions}>
          <Pressable
            style={[styles.actionBtn, { borderColor: c.borderSubtle }]}
            onPress={() => onAcknowledge(challenge.id)}
          >
            <Text variant="monoSmall">Sit with it</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { borderColor: c.borderSubtle }]}
            onPress={() => setRevising(true)}
          >
            <Text variant="monoSmall">Revise position</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function PositionDetailScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const { data: position, loading, error, refetch } = useApiQuery(
    () => api.positions.getByTopic(topicId!),
    [topicId],
  );

  async function handleAcknowledge(challengeId: string, revision?: string) {
    try {
      await api.positions.acknowledge(challengeId, revision);
      void refetch();
    } catch {
      void refetch();
    }
  }

  if (loading && !position) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <ActivityIndicator style={{ marginTop: Spacing[8] }} />
      </SafeAreaView>
    );
  }

  if (error || !position) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Pressable onPress={() => router.back()}><Text variant="body" color="muted">Back</Text></Pressable>
        </View>
        <Text variant="body" color="muted" style={{ padding: Spacing[4] }}>Position not found.</Text>
      </SafeAreaView>
    );
  }

  const pending = position.challenges.filter((ch) => !ch.acknowledged);
  const acknowledged = position.challenges.filter((ch) => ch.acknowledged);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()}>
          <Text variant="body" color="muted">Back</Text>
        </Pressable>
        <Text variant="monoSmall" color="muted">{position.topic.name}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.statementCard, { borderColor: c.border }]}>
          <Text variant="monoSmall" color="muted" style={styles.sectionLabel}>My position</Text>
          <Text variant="body" style={styles.statementText}>{position.statement}</Text>
          {position.status === 'REVISED' && (
            <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[2] }}>Revised</Text>
          )}
        </View>

        <Pressable
          style={[styles.dialogueBtn, { borderColor: c.border }]}
          onPress={() => router.push({ pathname: '/socratic/[topicId]' as never, params: { topicId: topicId! } })}
        >
          <Text variant="bodyMedium">Open Socratic dialogue →</Text>
        </Pressable>

        {pending.length > 0 && (
          <View>
            <Text variant="monoSmall" color="muted" style={styles.sectionLabel}>
              Challenges ({pending.length})
            </Text>
            {pending.map((ch) => (
              <ChallengeCard key={ch.id} challenge={ch} onAcknowledge={handleAcknowledge} />
            ))}
          </View>
        )}

        {acknowledged.length > 0 && (
          <View>
            <Text variant="monoSmall" color="muted" style={styles.sectionLabel}>
              Acknowledged ({acknowledged.length})
            </Text>
            {acknowledged.map((ch) => (
              <ChallengeCard key={ch.id} challenge={ch} onAcknowledge={handleAcknowledge} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: { padding: Spacing[4], gap: Spacing[4] },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[2] },
  statementCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
  },
  statementText: { marginTop: Spacing[2], lineHeight: 24 },
  dialogueBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
    alignItems: 'center',
  },
  challengeCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
    marginBottom: Spacing[3],
  },
  challengeSource: { textTransform: 'uppercase', letterSpacing: 0.5 },
  tensionText: { marginTop: Spacing[2], lineHeight: 22 },
  challengeActions: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginTop: Spacing[4],
  },
  actionBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingVertical: Spacing[2],
    alignItems: 'center',
  },
  revisionBlock: { marginTop: Spacing[3], gap: Spacing[3] },
  revisionInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    padding: Spacing[3],
    minHeight: 80,
    fontSize: 14,
    lineHeight: 20,
  },
  revisionActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
