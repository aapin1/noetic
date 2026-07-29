import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeftIcon } from 'lucide-react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

/**
 * The dark chrome band every screen wears at the top.
 *
 * Nine detail screens had each built their own version of this — a back
 * chevron, a centred title, a spacer to balance it — and each drifted its own
 * way on padding, title variant and ink. Now there is one, and it is the same
 * band the five tabs carry, so moving from a tab into a detail page doesn't
 * change what the top of the app looks like.
 *
 * `deep` is used HERE and essentially nowhere else. It is a near-black, and the
 * lesson from putting it on search fields, hero panels and blocks inside cards
 * is that at that value it stops being structure and starts being a hole in the
 * middle of the content. Framing the page — this band at the top, the tab bar
 * at the bottom — is the one job it does well, because a frame is read as the
 * edge of the page rather than as something sitting on it.
 *
 * It owns the safe-area inset itself (rather than the screen doing it) so the
 * band runs up under the notch. A screen that let its SafeAreaView pad the top
 * would leave a pale strip above the dark bar, which reads as a mistake.
 */
export function ScreenHeader({
  title,
  variant = 'mono',
  right,
  onBack,
}: {
  title: string;
  /** `mono` for a breadcrumb-ish label, `title` for a screen that owns a name. */
  variant?: 'mono' | 'title';
  right?: React.ReactNode;
  /** Defaults to router.back(). */
  onBack?: () => void;
}) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top + Spacing[2], backgroundColor: c.deep, borderBottomColor: c.deepBorder },
      ]}
    >
      <Pressable
        onPress={onBack ?? (() => router.back())}
        hitSlop={10}
        style={styles.slot}
        accessibilityLabel="Back"
        accessibilityRole="button"
      >
        <ChevronLeftIcon size={22} color={c.deepInk} />
      </Pressable>
      <Text
        variant={variant === 'title' ? 'h4' : 'monoSmall'}
        numberOfLines={1}
        style={[styles.title, { color: variant === 'title' ? c.deepInk : c.deepInkMuted }]}
      >
        {title}
      </Text>
      {/* Mirrors the back button's width so the title stays optically centred
          whether or not anything is passed on the right. */}
      <View style={[styles.slot, styles.slotEnd]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[3],
    borderBottomWidth: 1,
  },
  slot: { width: 40, alignItems: 'flex-start', justifyContent: 'center' },
  slotEnd: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
});
