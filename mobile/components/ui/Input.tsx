import React, { forwardRef, useMemo, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { FontFamily, FontSize, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
  multiline?: boolean;
  numberOfLines?: number;
}

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, hint, leftIcon, rightIcon, containerStyle, style, multiline, numberOfLines, ...props },
  ref,
) {
  const c = useThemeColors();
  const [focused, setFocused] = useState(false);

  const dynamic = useMemo(
    () =>
      StyleSheet.create({
        inputWrapper: {
          borderBottomColor: error ? c.danger : focused ? c.text : c.border,
        },
        input: {
          color: c.text,
        },
      }),
    [c, error, focused],
  );

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text variant="label" color="muted" style={styles.label}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.inputWrapper,
          dynamic.inputWrapper,
          !!error && styles.errored,
          multiline && styles.multilineWrapper,
        ]}
      >
        {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          ref={ref}
          style={[
            styles.input,
            dynamic.input,
            Boolean(leftIcon) && styles.inputWithLeftIcon,
            Boolean(rightIcon) && styles.inputWithRightIcon,
            Boolean(multiline) && styles.multilineInput,
            style,
          ]}
          placeholderTextColor={c.faint}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline={multiline}
          numberOfLines={numberOfLines}
          textAlignVertical={multiline ? 'top' : 'center'}
          contextMenuHidden={false}
          {...props}
        />
        {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
      </View>
      {error && (
        <Text variant="caption" color="danger" style={styles.errorText}>
          {error}
        </Text>
      )}
      {hint && !error && (
        <Text variant="caption" color="muted" style={styles.hintText}>
          {hint}
        </Text>
      )}
    </View>
  );
});

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: { marginBottom: Spacing[5] },
  label: { marginBottom: Spacing[2] },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    minHeight: 44,
  },
  multilineWrapper: {
    minHeight: 96,
    alignItems: 'flex-start',
    paddingVertical: Spacing[2],
  },
  errored: {},
  input: {
    flex: 1,
    paddingHorizontal: 0,
    paddingVertical: Spacing[3],
    fontFamily: FontFamily.sans,
    fontSize: FontSize.md,
    minHeight: 44,
  },
  inputWithLeftIcon: { paddingLeft: Spacing[2] },
  inputWithRightIcon: { paddingRight: Spacing[2] },
  multilineInput: {
    minHeight: 80,
    paddingTop: 0,
  },
  leftIcon: { paddingRight: Spacing[2] },
  rightIcon: { paddingLeft: Spacing[2] },
  errorText: {
    marginTop: Spacing[2],
  },
  hintText: { marginTop: Spacing[2] },
});
