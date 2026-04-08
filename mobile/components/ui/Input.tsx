import React, { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
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

export const Input = forwardRef<TextInput, Props>(
  ({ label, error, hint, leftIcon, rightIcon, containerStyle, style, multiline, numberOfLines, ...props }, ref) => {
    const [focused, setFocused] = useState(false);

    return (
      <View style={[styles.container, containerStyle]}>
        {label && (
          <Text variant="label" color="secondary" style={styles.label}>
            {label}
          </Text>
        )}
        <View
          style={[
            styles.inputWrapper,
            focused && styles.focused,
            !!error && styles.errored,
            multiline && styles.multilineWrapper,
          ]}
        >
          {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
          <TextInput
            ref={ref}
            style={[
              styles.input,
              leftIcon && styles.inputWithLeftIcon,
              rightIcon && styles.inputWithRightIcon,
              multiline && styles.multilineInput,
              style,
            ]}
            placeholderTextColor={Colors.mutedText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline={multiline}
            numberOfLines={numberOfLines}
            textAlignVertical={multiline ? 'top' : 'center'}
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
  },
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing[4],
  },
  label: {
    marginBottom: Spacing[2],
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    borderRadius: Radius.lg,
    minHeight: 48,
  },
  multilineWrapper: {
    minHeight: 100,
    alignItems: 'flex-start',
    paddingVertical: Spacing[3],
  },
  focused: {
    borderColor: Colors.inputFocusBorder,
    backgroundColor: Colors.surface,
  },
  errored: {
    borderColor: Colors.danger,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Colors.primaryText,
    minHeight: 48,
  },
  inputWithLeftIcon: {
    paddingLeft: Spacing[2],
  },
  inputWithRightIcon: {
    paddingRight: Spacing[2],
  },
  multilineInput: {
    minHeight: 80,
    paddingTop: 0,
  },
  leftIcon: {
    paddingLeft: Spacing[4],
  },
  rightIcon: {
    paddingRight: Spacing[4],
  },
  errorText: {
    marginTop: Spacing[1],
    color: Colors.danger,
  },
  hintText: {
    marginTop: Spacing[1],
  },
});
