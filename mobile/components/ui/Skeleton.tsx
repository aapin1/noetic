import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Colors, Radius } from '@/constants/theme';

interface Props {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, radius = Radius.sm, style }: Props) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 800 }),
        withTiming(0.4, { duration: 800 }),
      ),
      -1,
      false,
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        styles.base,
        { width: width as number, height, borderRadius: radius },
        animStyle,
        style,
      ]}
    />
  );
}

export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <Skeleton width={40} height={40} radius={Radius.full} />
        <View style={styles.cardHeaderText}>
          <Skeleton width="50%" height={13} />
          <Skeleton width="35%" height={11} style={{ marginTop: 6 }} />
        </View>
      </View>
      <Skeleton width="90%" height={18} style={{ marginTop: 16 }} />
      <Skeleton width="70%" height={14} style={{ marginTop: 8 }} />
      <Skeleton width="100%" height={12} style={{ marginTop: 12 }} />
      <Skeleton width="80%" height={12} style={{ marginTop: 6 }} />
      <View style={styles.cardFooter}>
        <Skeleton width={60} height={24} radius={Radius.full} />
        <Skeleton width={60} height={24} radius={Radius.full} />
      </View>
    </View>
  );
}

export function SkeletonProfile() {
  return (
    <View style={styles.profileContainer}>
      <View style={styles.profileHero}>
        <Skeleton width={80} height={80} radius={Radius.full} />
        <Skeleton width="60%" height={22} style={{ marginTop: 16 }} />
        <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
        <Skeleton width="80%" height={13} style={{ marginTop: 12 }} />
      </View>
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={i} style={{ marginTop: 16 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.skeletonBase,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius['3xl'],
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardHeaderText: {
    flex: 1,
    gap: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  profileContainer: {
    padding: 20,
  },
  profileHero: {
    alignItems: 'center',
    paddingVertical: 24,
  },
});
