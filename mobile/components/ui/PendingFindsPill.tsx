import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { XIcon } from 'lucide-react-native';

import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { GLASS_ACTIVE_BG, GLASS_BG, GLASS_BORDER, GLASS_BORDER_GLOW } from '@/constants/mapPalette';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { Text } from '@/components/ui/Text';
import type { PendingFinds } from '@/types/api';

const ACCENT = '#7EC8A0';

export type PendingPillPhase = 'ask' | 'adding' | 'done';

type Props = {
  top: number;
  finds: PendingFinds;
  phase: PendingPillPhase;
  /** How many were mapped, once done. */
  added: number;
  onAdd: () => void;
  onDecline: () => void;
  onClose: () => void;
};

const providerName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

function describe(finds: PendingFinds): string {
  const [g, ...rest] = finds.groups;
  if (!g) return 'Nothing waiting';
  const noun = finds.total === 1 ? 'find' : 'finds';
  if (rest.length === 0) return `${providerName(g.provider)} found ${g.count} ${g.count === 1 ? 'thing' : 'things'} you wrote about`;
  const names = finds.groups.map((x) => providerName(x.provider));
  return `${finds.total} ${noun} from ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The connected-accounts ask, in the capture pill's glass-and-cat idiom from
 * the right edge: what was found, and two answers. Shown on the Atlas when
 * finds are waiting and nothing else is speaking.
 */
export function PendingFindsPill({ top, finds, phase, added, onAdd, onDecline, onClose }: Props) {
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 8, tension: 60 }).start();
  }, [slide]);

  const firstTitle = finds.groups[0]?.titles[0];
  const line =
    phase === 'adding' ? 'Reading and mapping…' : phase === 'done' ? `${added} on your map` : describe(finds);

  return (
    <Animated.View
      style={[
        styles.pill,
        {
          top,
          backgroundColor: GLASS_BG,
          borderColor: GLASS_BORDER,
          opacity: slide,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [72, 0] }) }],
        },
      ]}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row} pointerEvents="auto">
        <AsciiLoader inline variant={phase === 'adding' ? 'mail' : 'cat'} idle={phase !== 'adding'} size={30} color="rgba(240,232,214,0.77)" />
        <Text style={[styles.mono, { color: 'rgba(240,232,214,0.69)', flex: 1 }]}>{line}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <XIcon size={14} color="rgba(240,232,214,0.55)" />
        </Pressable>
      </View>
      {phase === 'ask' && firstTitle ? (
        <Text style={[styles.mono, { color: 'rgba(240,232,214,0.45)' }]} numberOfLines={1}>
          {finds.total > 1 ? `${firstTitle} and ${finds.total - 1} more` : firstTitle}
        </Text>
      ) : null}
      {phase === 'ask' && (
        <View style={styles.actions} pointerEvents="auto">
          <Pressable
            onPress={onAdd}
            hitSlop={8}
            style={[styles.btn, { backgroundColor: 'rgba(126,200,160,0.15)', borderColor: 'rgba(126,200,160,0.32)' }]}
            accessibilityRole="button"
            accessibilityLabel="Add these to your map"
          >
            <Text style={[styles.action, { color: ACCENT }]}>Add</Text>
          </Pressable>
          <Pressable
            onPress={onDecline}
            hitSlop={8}
            style={[styles.btn, { backgroundColor: GLASS_ACTIVE_BG, borderColor: GLASS_BORDER_GLOW }]}
            accessibilityRole="button"
            accessibilityLabel="Leave these out"
          >
            <Text style={[styles.action, { color: 'rgba(240,232,214,0.84)' }]}>Not these</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: Spacing[4],
    width: 226,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
    gap: Spacing[3],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  mono: { fontFamily: FontFamily.sans, fontSize: FontSize.sm },
  btn: { borderWidth: 1, borderRadius: Radius.full, paddingVertical: 6, paddingHorizontal: Spacing[3] },
  action: { fontFamily: FontFamily.sans, fontSize: FontSize.sm, fontWeight: '600' },
});
