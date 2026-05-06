import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Brain } from '@/components/Brain';
import { InsightLine } from '@/components/InsightLine';

export default function PreviewScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [, setFinishing] = useState(false);

  const { data: captures } = useApiQuery(() => api.captures.list({ limit: 3 }), []);
  const first = captures?.[0];

  const finish = useCallback(async () => {
    setFinishing(true);
    await refreshProfile();
    router.replace('/(tabs)');
  }, [refreshProfile, router]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="label" color="muted">
          Ready
        </Text>
        <Text variant="h2" style={{ marginTop: Spacing[2] }}>
          Your memory is live
        </Text>
        <View style={styles.brainWrap}>
          <Brain size={200} density={56} showLines />
        </View>
        {first?.leadInsight ? (
          <View style={[styles.insightCard, { borderColor: c.border }]}>
            <Text variant="label" color="muted">
              Latest insight
            </Text>
            <View style={{ marginTop: Spacing[3] }}>
              <InsightLine
                insight={{
                  id: first.leadInsight.id,
                  type: first.leadInsight.type,
                  headline: first.leadInsight.headline,
                  body: '',
                  strength: 0.8,
                  evidence: {},
                }}
                compact
              />
            </View>
            <Pressable onPress={() => router.push(`/insight/${first.id}` as never)} style={{ marginTop: Spacing[4] }}>
              <Text variant="monoSmall" color="muted">
                Open full record →
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text variant="serif" color="secondary" style={{ marginTop: Spacing[6] }}>
            No seed capture yet. The first thing you store will produce the opening insight.
          </Text>
        )}

        <Button
          label="Enter"
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => void finish()}
          style={{ marginTop: Spacing[10] }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[12] },
  brainWrap: { alignItems: 'center', marginTop: Spacing[8] },
  insightCard: {
    marginTop: Spacing[8],
    padding: Spacing[5],
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
});
