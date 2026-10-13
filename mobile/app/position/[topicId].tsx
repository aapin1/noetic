import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { ChevronRightIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionKicker } from '@/components/ui/SectionKicker';
import { Button } from '@/components/ui/Button';
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
        <Text variant="subheadline" color="secondary">{captureTitle}</Text>
        <Text variant="caption" color="muted" style={{ marginTop: Spacing[2] }}>
          {challenge.revised ? 'Position revised' : 'Noted'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.challengeCard, { borderColor: c.border }]}>
      <Text variant="caption" color="muted">
        {captureTitle}
      </Text>
      <Text variant="body" color="secondary" style={styles.tensionText}>
        {challenge.tension}
      </Text>
      {revising ? (
        <View style={styles.revisionBlock}>
          <TextInput
            style={[styles.revisionInput, { color: c.text, borderColor: c.borderSubtle }]}
            placeholder="Revise your position"
            placeholderTextColor={c.faint}
            value={revisionText}
            onChangeText={setRevisionText}
            multiline
            textAlignVertical="top"
            autoFocus
          />
          <View style={styles.revisionActions}>
            <Button label="Cancel" variant="tertiary" size="sm" onPress={() => setRevising(false)} />
            <Button
              label="Save revision"
              variant="primary"
              size="sm"
              disabled={revisionText.trim().length < 10}
              onPress={() => onAcknowledge(challenge.id, revisionText)}
            />
          </View>
        </View>
      ) : (
        <View style={styles.challengeActions}>
          <Button label="Hold position" variant="secondary" size="sm" style={styles.actionBtn} onPress={() => onAcknowledge(challenge.id)} />
          <Button label="Revise position" variant="secondary" size="sm" style={styles.actionBtn} onPress={() => setRevising(true)} />
        </View>
      )}
    </View>
  );
}

export default function PositionDetailScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const { data: position, loading, refetch } = useApiQuery(
    () => api.positions.getByTopic(topicId!),
    [topicId],
    { cacheKey: `position:${topicId}` },
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
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
        <ActivityIndicator style={{ marginTop: Spacing[8] }} />
      </SafeAreaView>
    );
  }

  if (!position) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
        <ScreenHeader title="Position" />
        <Text variant="body" color="muted" style={{ padding: Spacing[4] }}>Position not found.</Text>
      </SafeAreaView>
    );
  }

  const pending = position.challenges.filter((ch) => !ch.acknowledged);
  const acknowledged = position.challenges.filter((ch) => ch.acknowledged);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title={position.topic.name} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.statementCard, { borderColor: c.border }]}>
          <SectionKicker label="My position" />
          <Text variant="body" style={styles.statementText}>{position.statement}</Text>
          {position.status === 'REVISED' && (
            <Text variant="caption" color="muted" style={{ marginTop: Spacing[2] }}>Revised</Text>
          )}
        </View>

        <Pressable
          style={[styles.dialogueBtn, { borderColor: c.border }]}
          onPress={() => router.push({ pathname: '/socratic/[topicId]' as never, params: { topicId: topicId! } })}
          accessibilityRole="button"
          accessibilityLabel="Open Socratic dialogue"
        >
          <Text variant="bodyMedium" style={{ flex: 1 }}>Open Socratic dialogue</Text>
          <ChevronRightIcon size={18} color={c.muted} />
        </Pressable>

        {pending.length > 0 && (
          <View>
            <SectionKicker label={`Challenges (${pending.length})`} style={styles.sectionLabel} />
            {pending.map((ch) => (
              <ChallengeCard key={ch.id} challenge={ch} onAcknowledge={handleAcknowledge} />
            ))}
          </View>
        )}

        {acknowledged.length > 0 && (
          <View>
            <SectionKicker label={`Acknowledged (${acknowledged.length})`} style={styles.sectionLabel} />
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
  content: { padding: Spacing[4], gap: Spacing[4] },
  sectionLabel: { marginBottom: Spacing[2] },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  challengeCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
    marginBottom: Spacing[3],
  },
  tensionText: { marginTop: Spacing[2], lineHeight: 22 },
  challengeActions: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginTop: Spacing[4],
  },
  actionBtn: { flex: 1 },
  revisionBlock: { marginTop: Spacing[3], gap: Spacing[3] },
  revisionInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    padding: Spacing[3],
    minHeight: 80,
    fontFamily: FontFamily.sans,
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  revisionActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing[2],
  },
});
