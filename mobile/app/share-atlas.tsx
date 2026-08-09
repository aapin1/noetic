import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckIcon, XIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useDisclosure } from '@/contexts/DisclosureContext';
import { EVENT_FLAGS, isAnonymousHandle } from '@/lib/disclosure';
import { Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Whisper } from '@/components/ui/Whisper';
import { Button } from '@/components/ui/Button';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { AtlasShareCard } from '@/components/share/AtlasCard';
import { captureFrame, saveFramesToPhotos, shareImage } from '@/lib/recap';
import { resolveTemplate, type RecapTemplateId } from '@/lib/recapTemplates';
import { atlasStatLine } from '@/lib/atlasShare';

/**
 * Preview + share flow for the atlas card. Same contract as the recap
 * composer: the preview view IS the captured image (react-native-view-shot on
 * the matte-wrapped card), and the Photos/share-sheet plumbing is shared with
 * recap wholesale.
 *
 * Two looks, both lifted from the recap templates so a user's cards feel like
 * one set: Ink (the map on its native dark ground) and Mono (the ascii-minimal
 * white chart).
 */

const VARIANTS: { id: RecapTemplateId; name: string; blurb: string; swatch: string[] }[] = [
  { id: 'ink', name: 'Ink', blurb: 'dark, quiet', swatch: ['#0E0E0E', '#6E9AD1', '#DFA26B'] },
  { id: 'mono', name: 'Mono', blurb: 'light, ascii', swatch: ['#FFFFFF', '#121212', '#6E9AD1'] },
];

/** Render up to this many recent points — matches the server's focus-map cap. */
const ATLAS_SHARE_LIMIT = 200;

export default function ShareAtlasScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile } = useAuth();
  const { width: screenW } = useWindowDimensions();
  const cardW = Math.min(screenW - Spacing[6] * 2, 360);

  const { data: graph, loading } = useApiQuery(
    () => api.memory.graph({ limit: ATLAS_SHARE_LIMIT }),
    [],
    { cacheKey: 'atlasShare.graph' },
  );

  const [variant, setVariant] = useState<RecapTemplateId>('ink');
  const [showLabels, setShowLabels] = useState(false);
  const [busy, setBusy] = useState(false);

  const frameRef = useRef<View | null>(null);
  const { markSeen } = useDisclosure();

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const clusters = graph?.clusters ?? [];

  const statLine = useMemo(() => {
    const fieldIds = new Set<string>();
    for (const n of nodes) {
      for (const t of n.topics) {
        if (t.kind === 'general') fieldIds.add(t.topicId);
      }
    }
    // totalCount is every point on the map, even past the render cap — the
    // stat line should say the true size of the mind, not the fetch limit.
    return atlasStatLine(graph?.totalCount ?? nodes.length, fieldIds.size);
  }, [graph, nodes]);

  const palette = useMemo(() => resolveTemplate(variant, 0), [variant]);

  const handleShare = useCallback(async () => {
    setBusy(true);
    try {
      const view = frameRef.current;
      if (view) {
        await shareImage(await captureFrame(view));
        // Sharing the atlas is the moment of strength Pulse reveals from.
        markSeen(EVENT_FLAGS.sharedAtlas);
      }
    } catch (e) {
      Alert.alert('Couldn’t make your image', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, [markSeen]);

  const handleSave = useCallback(async () => {
    setBusy(true);
    try {
      const view = frameRef.current;
      if (view) {
        const saved = await saveFramesToPhotos([await captureFrame(view)]);
        if (saved) {
          markSeen(EVENT_FLAGS.sharedAtlas);
          Alert.alert('Saved to Photos', 'Your atlas is in your camera roll.');
        }
      }
    } catch (e) {
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, [markSeen]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close" hitSlop={8}>
          <XIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="monoSmall" color="muted" style={styles.headerTitle} numberOfLines={1}>
          Share your atlas
        </Text>
        <View style={{ width: 22 }} />
      </View>

      {loading && !graph ? (
        <AsciiLoader fill variant="cat" size={80} message="charting your constellation…" />
      ) : nodes.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text variant="monoSmall" color="muted" style={{ textAlign: 'center', letterSpacing: 1.2 }}>
            save something first — your atlas appears as you capture.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text variant="label" color="muted" style={styles.pickerLabel}>
              look
            </Text>
            <View style={styles.variantRow}>
              {VARIANTS.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => setVariant(v.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: variant === v.id }}
                  style={[
                    styles.swatch,
                    { borderColor: variant === v.id ? c.text : c.border, backgroundColor: c.surface },
                    variant === v.id && { borderWidth: 2 },
                  ]}
                >
                  <View style={[styles.swatchStrip, { borderColor: c.border }]}>
                    {v.swatch.map((color, i) => (
                      <View key={i} style={{ flex: 1, backgroundColor: color }} />
                    ))}
                  </View>
                  <Text variant="serif" style={{ color: c.text, marginTop: Spacing[2] }}>
                    {v.name}
                  </Text>
                  <Text variant="monoSmall" style={{ color: c.faint }} numberOfLines={1}>
                    {v.blurb}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Labels are opt-in: the shape of a mind is shareable by default,
                what it's about is the owner's to reveal. */}
            <Pressable
              onPress={() => setShowLabels((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: showLabels }}
              style={styles.toggleRow}
            >
              <View
                style={[
                  styles.check,
                  showLabels
                    ? { backgroundColor: c.text, borderColor: c.text }
                    : { borderColor: c.border },
                ]}
              >
                {showLabels ? <CheckIcon size={14} color={c.inverseText} strokeWidth={3} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="serif">show field names</Text>
                <Text variant="monoSmall" color="faint" style={{ marginTop: 2 }}>
                  off = just the shape of your mind
                </Text>
              </View>
            </Pressable>

            <View style={styles.preview}>
              <View
                ref={frameRef}
                collapsable={false}
                style={[styles.frameMatte, { backgroundColor: palette.bg }]}
              >
                <AtlasShareCard
                  p={palette}
                  width={cardW}
                  handle={profile?.handle ?? null}
                  nodes={nodes}
                  edges={edges}
                  clusters={clusters}
                  showLabels={showLabels}
                  statLine={statLine}
                />
              </View>
            </View>
          </ScrollView>

          <View style={[styles.bar, { borderTopColor: c.border, backgroundColor: c.background }]}>
            {/* First touch of sharing is the first time a generated handle is
                about to be seen by someone else — the one moment identity
                editing is worth a line. */}
            <Whisper
              id="identity-claim"
              when={isAnonymousHandle(profile?.handle)}
              text={`you're @${profile?.handle ?? ''} — make it yours?`}
              onPress={() => router.push('/profile/edit' as never)}
              style={{ alignSelf: 'center', marginBottom: Spacing[2] }}
            />
            <Button label="Share image" fullWidth loading={busy} onPress={() => void handleShare()} />
            <Pressable onPress={() => void handleSave()} disabled={busy} style={styles.subAction}>
              <Text variant="monoSmall" color="muted">
                or save to Photos →
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  content: { paddingTop: Spacing[5], paddingBottom: Spacing[8] },
  pickerLabel: { paddingHorizontal: Spacing[6], marginBottom: Spacing[1] },
  variantRow: {
    flexDirection: 'row',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[2],
  },
  swatch: {
    flex: 1,
    maxWidth: 160,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[3],
  },
  swatchStrip: {
    flexDirection: 'row',
    height: 40,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
    gap: Spacing[4],
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: { alignItems: 'center', paddingVertical: Spacing[4] },
  // Matte around the captured card so the exported PNG is a filled rectangle,
  // exactly like the recap composer's frameMatte.
  frameMatte: { padding: Spacing[5], borderRadius: Radius.xl },
  emptyWrap: { paddingTop: Spacing[16], paddingHorizontal: Spacing[8] },
  bar: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[6],
    borderTopWidth: 1,
  },
  subAction: { alignSelf: 'center', paddingVertical: Spacing[3] },
});
