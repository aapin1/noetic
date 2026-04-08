import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon, LinkIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { ONBOARDING_TOPICS } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import * as Haptics from 'expo-haptics';

type Step = 'url' | 'form';

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const VISIBILITY_OPTIONS = [
  { value: 'PUBLIC', label: 'Public' },
  { value: 'FOLLOWERS', label: 'Followers only' },
  { value: 'PRIVATE', label: 'Private' },
];

export default function LogScreen() {
  const router = useRouter();
  const { contentId } = useLocalSearchParams<{ contentId?: string }>();

  const [step, setStep] = useState<Step>(contentId ? 'form' : 'url');
  const [url, setUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [resolvedContentId, setResolvedContentId] = useState(contentId ?? '');
  const [resolvedTitle, setResolvedTitle] = useState('');

  const [rating, setRating] = useState<number | null>(null);
  const [review, setReview] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [visibility, setVisibility] = useState('PUBLIC');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleFetchUrl = async () => {
    if (!url.trim()) return;
    setUrlLoading(true);
    setUrlError('');
    try {
      const result = await api.content.ingest(url.trim());
      if (result.requiresManualInput) {
        setUrlError('Could not fetch metadata automatically. Please log content manually.');
        return;
      }
      if (!result.contentItem.id) {
        setUrlError('Could not resolve content. Try a different URL.');
        return;
      }
      setResolvedContentId(result.contentItem.id);
      setResolvedTitle(result.contentItem.title ?? url.trim());
      setStep('form');
    } catch {
      setUrlError('Could not fetch this URL. Check the link and try again.');
    } finally {
      setUrlLoading(false);
    }
  };

  const toggleTopic = (t: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTopics((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!resolvedContentId) { setError('No content to log.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await api.logs.create({
        contentItemId: resolvedContentId,
        rating: rating ?? undefined,
        review: review.trim() || undefined,
        annotation: annotation.trim() || undefined,
        topics: topics.size > 0 ? Array.from(topics) : undefined,
        visibility,
      });
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save log. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Cancel">
          <ChevronLeftIcon size={22} color={Colors.primaryText} />
        </Pressable>
        <Text style={{ fontFamily: FontFamily.heading, fontSize: 16, color: Colors.primaryText }}>
          {step === 'url' ? 'Log content' : 'Add details'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 'url' && (
            <View>
              <Text variant="h3" style={{ marginBottom: Spacing[2] }}>What did you read, watch, or listen to?</Text>
              <Text variant="body" color="secondary" style={{ marginBottom: Spacing[6] }}>
                Paste a URL and we'll pull the metadata automatically.
              </Text>
              <Input
                label="URL"
                value={url}
                onChangeText={setUrl}
                placeholder="https://..."
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleFetchUrl}
                leftIcon={<LinkIcon size={16} color={Colors.mutedText} />}
                error={urlError}
              />
              <Button
                label="Fetch content"
                onPress={handleFetchUrl}
                variant="primary"
                size="lg"
                fullWidth
                loading={urlLoading}
                disabled={!url.trim() || urlLoading}
                style={{ marginTop: Spacing[2] }}
              />
            </View>
          )}

          {step === 'form' && (
            <View>
              {resolvedTitle ? (
                <View style={styles.resolvedCard}>
                  <Text variant="monoSmall" color="accent">Content found</Text>
                  <Text variant="bodyMedium" style={{ marginTop: 4 }}>{resolvedTitle}</Text>
                </View>
              ) : null}

              {error ? (
                <View style={styles.errorBanner}>
                  <Text variant="caption" color="danger">{error}</Text>
                </View>
              ) : null}

              <Text variant="label" color="secondary" style={styles.fieldLabel}>Rating (optional)</Text>
              <View style={styles.ratingRow}>
                {RATINGS.map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setRating(rating === r ? null : r);
                    }}
                    style={[styles.ratingBtn, rating === r && styles.ratingBtnSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: rating === r }}
                    accessibilityLabel={`Rating ${r}`}
                  >
                    <Text
                      style={[
                        styles.ratingLabel,
                        rating === r && styles.ratingLabelSelected,
                      ]}
                    >
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Input
                label="Review (optional)"
                value={review}
                onChangeText={setReview}
                placeholder="What did you think? Be honest."
                multiline
                numberOfLines={4}
              />

              <Input
                label="Private annotation (optional)"
                value={annotation}
                onChangeText={setAnnotation}
                placeholder="Notes for yourself only..."
                multiline
                numberOfLines={3}
                hint="Only visible to you."
              />

              <Text variant="label" color="secondary" style={styles.fieldLabel}>Topics (optional)</Text>
              <View style={styles.topicsGrid}>
                {ONBOARDING_TOPICS.slice(0, 16).map((t) => (
                  <Pressable key={t} onPress={() => toggleTopic(t)}>
                    <Badge
                      label={t}
                      variant="topic"
                      selected={topics.has(t)}
                    />
                  </Pressable>
                ))}
              </View>

              <Text variant="label" color="secondary" style={styles.fieldLabel}>Visibility</Text>
              {VISIBILITY_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setVisibility(opt.value);
                  }}
                  style={[styles.visRow, visibility === opt.value && styles.visRowSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: visibility === opt.value }}
                  accessibilityLabel={opt.label}
                >
                  <View style={[styles.radio, visibility === opt.value && styles.radioFilled]} />
                  <Text variant="body">{opt.label}</Text>
                </Pressable>
              ))}

              <Button
                label={submitting ? 'Saving…' : 'Save log'}
                onPress={handleSubmit}
                variant="primary"
                size="lg"
                fullWidth
                loading={submitting}
                style={{ marginTop: Spacing[6] }}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  backBtn: { padding: Spacing[2] },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing[6], paddingVertical: Spacing[6], paddingBottom: Spacing[12] },
  resolvedCard: {
    backgroundColor: 'rgba(120,211,157,0.1)',
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[5],
    borderWidth: 1,
    borderColor: 'rgba(120,211,157,0.3)',
  },
  errorBanner: {
    backgroundColor: 'rgba(232,108,108,0.1)',
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(232,108,108,0.3)',
  },
  fieldLabel: { marginBottom: Spacing[2], marginTop: Spacing[2] },
  ratingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[5],
  },
  ratingBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBtnSelected: {
    borderColor: Colors.accentGold,
    backgroundColor: Colors.accentGoldLight,
  },
  ratingLabel: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    color: Colors.secondaryText,
  },
  ratingLabelSelected: {
    color: Colors.primaryText,
  },
  topicsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[5],
  },
  visRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.surface,
    marginBottom: Spacing[2],
  },
  visRowSelected: {
    borderColor: Colors.accentGold,
    backgroundColor: Colors.accentGoldLight,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.inputBorder,
  },
  radioFilled: {
    borderColor: Colors.accentGold,
    backgroundColor: Colors.accentGold,
  },
});
