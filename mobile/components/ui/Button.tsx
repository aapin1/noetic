import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  style?: ViewStyle;
  /**
   * Tints a `secondary` button with a subject colour instead of leaving it the
   * neutral grey block. Same recipe as a topic badge — a wash, a half-strength
   * border and the label in full — so an accented button reads as part of the
   * same family as everything else on the page rather than as the one
   * monochrome control left over from before the palette existed.
   */
  accent?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  style,
  accent,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const c = useThemeColors();
  const opacity = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const dynamic = useMemo(() => {
    const tinted = variant === 'secondary' && !!accent;
    const labelOnPrimary = variant === 'primary' || variant === 'danger' ? c.inverseText : c.text;
    const labelColor = tinted ? accent! : labelOnPrimary;
    return {
      labelColor,
      spinnerColor: labelColor,
      bg:
        variant === 'primary'
          ? c.inverse
          : variant === 'danger'
            ? c.danger
            // `secondary` used to be a transparent outline. An outline has no
            // fill, so it sat out every change to the palette and ended up the
            // one control on a screen that still looked untouched. It is a
            // button; it gets a body.
            : variant === 'secondary'
              ? (tinted ? `${accent!}1F` : c.elevated)
              : 'transparent',
      border: variant === 'secondary' ? (tinted ? `${accent!}66` : c.border) : 'transparent',
    };
  }, [c, variant, accent]);

  const handlePressIn = () => {
    opacity.value = withTiming(0.78, { duration: 120 });
  };

  const handlePressOut = () => {
    opacity.value = withTiming(1, { duration: 180 });
  };

  const handlePress = () => {
    Haptics.selectionAsync();
    onPress?.();
  };

  const isDisabled = disabled || loading;

  return (
    <AnimatedPressable
      style={[
        animStyle,
        styles.base,
        styles[size],
        fullWidth && styles.fullWidth,
        {
          backgroundColor: dynamic.bg,
          borderColor: dynamic.border,
          borderWidth: variant === 'secondary' ? 1 : 0,
        },
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={dynamic.spinnerColor} />
      ) : (
        <View style={styles.inner}>
          {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
          <Text
            style={[
              styles.label,
              styles[`label_${size}`],
              { color: dynamic.labelColor, fontFamily: FontFamily.sansMedium },
            ]}
          >
            {label}
          </Text>
          {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fullWidth: { width: '100%' },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  iconLeft: { marginRight: 10 },
  iconRight: { marginLeft: 10 },
  sm: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    minHeight: 36,
  },
  md: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
    minHeight: 46,
  },
  lg: {
    paddingHorizontal: Spacing[8],
    paddingVertical: Spacing[4],
    minHeight: 54,
  },
  disabled: {
    opacity: 0.35,
  },
  label: {
    letterSpacing: 0.5,
  },
  label_sm: { fontSize: FontSize.sm },
  label_md: { fontSize: FontSize.base },
  label_lg: { fontSize: FontSize.md },
});
