import React, { forwardRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { SearchIcon, XCircleIcon } from 'lucide-react-native';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

interface Props extends Omit<TextInputProps, 'style'> {
  value: string;
  onChangeText: (text: string) => void;
  /** Shows a spinner in the trailing slot while a lookup is in flight. */
  busy?: boolean;
  /** Override the field's tint for an always-dark surface (the Atlas). */
  tone?: { background: string; border: string; text: string; icon: string };
  style?: ViewStyle;
}

/**
 * The iOS search bar: a recessed capsule with a magnifying glass on the left,
 * the text, and a clear button that appears once there is something to clear.
 */
export const SearchField = forwardRef<TextInput, Props>(function SearchField(
  { value, onChangeText, busy = false, tone, style, placeholder = 'Search', ...props },
  ref,
) {
  const c = useThemeColors();
  const bg = tone?.background ?? c.elevated;
  const border = tone?.border ?? c.border;
  const text = tone?.text ?? c.text;
  const icon = tone?.icon ?? c.muted;
  return (
    <View style={[styles.box, { backgroundColor: bg, borderColor: border }, style]}>
      <SearchIcon size={17} color={icon} strokeWidth={2} />
      <TextInput
        ref={ref}
        style={[styles.input, { color: text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={icon}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        {...props}
      />
      {busy ? (
        <ActivityIndicator size="small" color={icon} />
      ) : value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Clear search" accessibilityRole="button">
          <XCircleIcon size={18} color={icon} fill={icon} stroke={bg} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[3],
    minHeight: 38,
  },
  input: {
    flex: 1,
    fontFamily: FontFamily.sans,
    fontSize: FontSize.md,
    paddingVertical: Spacing[2],
  },
});
