import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

/**
 * A small floating "collapse the keyboard" control, mounted once at the app
 * root. Whenever any keyboard is up — multiline fields have no return-to-
 * dismiss — it hovers just above it, and a tap dismisses. One component
 * covers every input in the app, including the onboarding walkthrough.
 */
export function KeyboardDismissButton() {
  const c = useThemeColors();
  const [kbHeight, setKbHeight] = useState<number | null>(null);

  useEffect(() => {
    // iOS overlays the keyboard, so the button offsets by its height (using
    // willShow so it appears in step with the keyboard). Android (resize
    // mode) shrinks the window instead, so the bottom edge already sits
    // above the keyboard.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(Platform.OS === 'ios' ? e.endCoordinates?.height ?? 0 : 0);
    });
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (kbHeight === null) return null;

  return (
    <View
      style={[styles.wrap, { bottom: kbHeight + Spacing[3] }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => Keyboard.dismiss()}
        style={[styles.btn, { backgroundColor: c.elevated, borderColor: c.border }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Hide keyboard"
      >
        <ChevronDown size={18} color={c.muted} strokeWidth={1.6} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing[4],
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
});
