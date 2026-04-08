import React from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'expo-router';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

const { width } = Dimensions.get('window');

function WordmarkHeader() {
  return (
    <View style={styles.wordmark}>
      <Text
        style={{
          fontFamily: FontFamily.heading,
          fontSize: 22,
          color: Colors.primaryText,
          letterSpacing: 4,
        }}
      >
        NOETIC
      </Text>
    </View>
  );
}

function SampleCard({
  type,
  title,
  handle,
  score,
}: {
  type: 'profile' | 'content' | 'compare';
  title: string;
  handle?: string;
  score?: number;
}) {
  const bg =
    type === 'profile'
      ? Colors.surface
      : type === 'content'
      ? Colors.elevatedSurface
      : Colors.softHighlight;

  return (
    <View style={[styles.sampleCard, { backgroundColor: bg }]}>
      {type === 'profile' && (
        <View>
          <View style={styles.sampleAvatarRow}>
            <View style={styles.sampleAvatar} />
            <View style={styles.sampleAvatarInfo}>
              <View style={[styles.sampleLine, { width: 80 }]} />
              <View style={[styles.sampleLine, { width: 55, marginTop: 5, opacity: 0.4 }]} />
            </View>
          </View>
          <View style={{ marginTop: 12, flexDirection: 'row', gap: 6 }}>
            {['philosophy', 'design', 'AI'].map((t) => (
              <View key={t} style={styles.sampleBadge}>
                <Text
                  style={{
                    fontFamily: FontFamily.mono,
                    fontSize: 9,
                    color: Colors.secondaryText,
                  }}
                >
                  {t}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {type === 'content' && (
        <View>
          <View style={styles.sampleBadge}>
            <Text style={{ fontFamily: FontFamily.mono, fontSize: 9, color: Colors.accentViolet }}>
              article
            </Text>
          </View>
          <Text
            style={{
              fontFamily: FontFamily.heading,
              fontSize: 15,
              color: Colors.primaryText,
              marginTop: 8,
              lineHeight: 21,
            }}
          >
            {title}
          </Text>
          <View style={[styles.sampleLine, { width: '70%', marginTop: 8 }]} />
          <View style={[styles.sampleLine, { width: '55%', marginTop: 5 }]} />
        </View>
      )}
      {type === 'compare' && (
        <View>
          <View style={styles.compareRow}>
            <View style={styles.sampleAvatar} />
            <View style={styles.compareScore}>
              <Text
                style={{
                  fontFamily: FontFamily.heading,
                  fontSize: 22,
                  color: Colors.accentGold,
                }}
              >
                {score}%
              </Text>
              <Text
                style={{
                  fontFamily: FontFamily.mono,
                  fontSize: 9,
                  color: Colors.mutedText,
                }}
              >
                overlap
              </Text>
            </View>
            <View style={styles.sampleAvatar} />
          </View>
          <View style={[styles.sampleLine, { width: '80%', alignSelf: 'center', marginTop: 10 }]} />
        </View>
      )}
    </View>
  );
}

function FeatureSection({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.feature}>
      <Text
        style={{
          fontFamily: FontFamily.mono,
          fontSize: FontSize.xs,
          color: Colors.accentGold,
          letterSpacing: 1,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
      </Text>
      <Text variant="h3" style={{ marginBottom: 6 }}>
        {title}
      </Text>
      <Text variant="body" color="secondary">
        {body}
      </Text>
    </View>
  );
}

export default function LandingScreen() {
  const router = useRouter();
  const { isAuthenticated, hasProfile, isLoading } = useAuth();

  if (!isLoading && isAuthenticated && hasProfile) {
    return <Redirect href="/(tabs)" />;
  }
  if (!isLoading && isAuthenticated && !hasProfile) {
    return <Redirect href="/(onboarding)/topics" />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <WordmarkHeader />

        <View style={styles.hero}>
          <View style={styles.heroLeft}>
            <Text
              style={{
                fontFamily: FontFamily.heading,
                fontSize: 38,
                color: Colors.primaryText,
                lineHeight: 44,
                letterSpacing: -1,
              }}
            >
              Your intellectual{'\n'}identity,{' '}
              <Text
                style={{
                  fontFamily: FontFamily.heading,
                  fontSize: 38,
                  color: Colors.accentGold,
                  lineHeight: 44,
                }}
              >
                visible.
              </Text>
            </Text>
            <Text
              variant="body"
              color="secondary"
              style={{ marginTop: 14, lineHeight: 24, maxWidth: width * 0.72 }}
            >
              Log, rank, and share the books, essays, films, and ideas that shape how you think.
            </Text>
            <View style={styles.heroButtons}>
              <Button
                label="Create profile"
                onPress={() => router.push('/(auth)/sign-up')}
                variant="primary"
                size="lg"
                fullWidth
              />
              <Button
                label="Sign in"
                onPress={() => router.push('/(auth)/sign-in')}
                variant="secondary"
                size="lg"
                fullWidth
              />
            </View>
          </View>
        </View>

        <View style={styles.previewStack}>
          <SampleCard type="profile" title="" />
          <SampleCard
            type="content"
            title="The Unreasonable Effectiveness of Mathematics"
          />
          <SampleCard type="compare" title="" score={74} />
        </View>

        <View style={styles.divider} />

        <FeatureSection
          label="Taste"
          title="Your taste, quantified"
          body="Every item you log strengthens your taste graph — a living map of your intellectual fingerprint."
        />
        <FeatureSection
          label="Identity"
          title="Show, don't just tell"
          body="Your public profile is your intellectual record. Rankings, reviews, and annotations become your signal."
        />
        <FeatureSection
          label="Signal"
          title="Find your intellectual kin"
          body="NOETIC computes overlap between profiles so you can discover people who think like you do."
        />

        <View style={styles.socialProof}>
          {['Philosophy · Design · AI', 'Economics · History · Film', 'Science · Literature · Law'].map(
            (line) => (
              <View key={line} style={styles.proofChip}>
                <Text
                  style={{
                    fontFamily: FontFamily.mono,
                    fontSize: FontSize.xs,
                    color: Colors.secondaryText,
                  }}
                >
                  {line}
                </Text>
              </View>
            ),
          )}
        </View>

        <View style={styles.finalCta}>
          <Text variant="h2" style={{ textAlign: 'center', marginBottom: 12 }}>
            Build your profile
          </Text>
          <Text
            variant="body"
            color="secondary"
            style={{ textAlign: 'center', marginBottom: 24 }}
          >
            It takes two minutes. Your intellectual footprint lasts.
          </Text>
          <Button
            label="Create profile"
            onPress={() => router.push('/(auth)/sign-up')}
            variant="primary"
            size="lg"
            style={{ alignSelf: 'center', minWidth: 200 }}
          />
        </View>

        <View style={styles.footer}>
          <Text variant="monoSmall" color="muted" style={{ textAlign: 'center' }}>
            NOETIC · A public intellectual identity network
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 60 },

  wordmark: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[5],
    paddingBottom: Spacing[4],
  },

  hero: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
  },
  heroLeft: {},
  heroButtons: {
    marginTop: Spacing[6],
    gap: Spacing[3],
  },

  previewStack: {
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[8],
    gap: Spacing[3],
  },
  sampleCard: {
    borderRadius: Radius['3xl'],
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: Spacing[5],
  },
  sampleAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sampleAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accentGold,
    opacity: 0.5,
  },
  sampleAvatarInfo: { flex: 1 },
  sampleLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primaryText,
    opacity: 0.1,
  },
  sampleBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: Colors.accentGoldLight,
    borderWidth: 1,
    borderColor: 'rgba(200,165,91,0.2)',
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  compareScore: { alignItems: 'center' },

  divider: {
    height: 1,
    backgroundColor: Colors.cardBorder,
    marginHorizontal: Spacing[6],
    marginVertical: Spacing[8],
  },

  feature: {
    paddingHorizontal: Spacing[6],
    marginBottom: Spacing[8],
  },

  socialProof: {
    paddingHorizontal: Spacing[6],
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[10],
    justifyContent: 'center',
  },
  proofChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },

  finalCta: {
    paddingHorizontal: Spacing[6],
    marginBottom: Spacing[10],
  },

  footer: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[8],
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
});
