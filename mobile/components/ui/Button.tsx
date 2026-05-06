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
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const c = useThemeColors();
  const opacity = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const dynamic = useMemo(() => {
    const labelOnPrimary = variant === 'primary' || variant === 'danger' ? c.inverseText : c.text;
    return {
      labelColor: labelOnPrimary,
      spinnerColor: labelOnPrimary,
      bg:
        variant === 'primary'
          ? c.inverse
          : variant === 'danger'
            ? c.danger
            : 'transparent',
      border: variant === 'secondary' ? c.border : 'transparent',
    };
  }, [c, variant]);

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
