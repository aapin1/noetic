import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

interface Props {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 14, radius = Radius.xs, style }: Props) {
  const c = useThemeColors();
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: 1100 }),
        withTiming(0.45, { duration: 1100 }),
      ),
      -1,
      false,
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { backgroundColor: c.borderSubtle },
        styles.base,
        { width: width as number, height, borderRadius: radius },
        animStyle,
        style,
      ]}
    />
  );
}

export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { borderTopColor: c.border }, style]}>
      <Skeleton width="40%" height={11} />
      <Skeleton width="92%" height={20} style={{ marginTop: 12 }} />
      <Skeleton width="78%" height={14} style={{ marginTop: 10 }} />
      <Skeleton width="60%" height={14} style={{ marginTop: 6 }} />
    </View>
  );
}

export function SkeletonProfile() {
  return (
    <View style={styles.profileContainer}>
      <View style={styles.profileHero}>
        <Skeleton width={56} height={56} radius={Radius.full} />
        <Skeleton width="60%" height={22} style={{ marginTop: 16 }} />
        <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
      </View>
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={i} style={{ marginTop: 16 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {},
  card: {
    backgroundColor: 'transparent',
    paddingVertical: Spacing[5],
    paddingHorizontal: Spacing[6],
    borderTopWidth: 1,
  },
  profileContainer: {
    paddingHorizontal: Spacing[6],
  },
  profileHero: {
    alignItems: 'center',
    paddingVertical: Spacing[6],
  },
});
