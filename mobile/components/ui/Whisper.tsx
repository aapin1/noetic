import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useDisclosure, useWhisper } from '@/contexts/DisclosureContext';
import type { WhisperId } from '@/lib/disclosure';
import { Text } from './Text';

// Long enough to be read twice, short enough that an ignored line doesn't
// become furniture.
const VISIBLE_MS = 10_000;
const FADE_MS = 450;

interface Props {
  id: WhisperId;
  /** The condition under which this whisper wants to speak. */
  when: boolean;
  /** One lowercase line. No punctuation ceremony, no exclamation marks. */
  text: string;
  /** Tapping the line performs the thing it points at, then retires it. */
  onPress?: () => void;
  style?: ViewStyle;
}

/**
 * One lowercase mono line anchored to the thing it describes. Render it where
 * the subject lives; the disclosure context guarantees at most one whisper is
 * speaking at a time and that each id fires exactly once per install.
 */
export function Whisper({ id, when, text, onPress, style }: Props) {
  const c = useThemeColors();
  const speaking = useWhisper(id, when);
  const { dismissWhisper } = useDisclosure();
  const opacity = useRef(new Animated.Value(0)).current;
  // Keeps the line mounted through its fade-out after the context moves on.
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (speaking) {
      setRendered(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      const timer = setTimeout(dismissWhisper, VISIBLE_MS);
      return () => clearTimeout(timer);
    }
    if (rendered) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [speaking, rendered, opacity, dismissWhisper]);

  if (!rendered) return null;

  const line = (
    <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 0.5 }}>
      {text}
    </Text>
  );

  return (
    <Animated.View style={[styles.wrap, { opacity }, style]} pointerEvents={onPress ? 'auto' : 'none'}>
      {onPress ? (
        <Pressable
          hitSlop={8}
          onPress={() => {
            dismissWhisper();
            onPress();
          }}
        >
          {line}
        </Pressable>
      ) : (
        <View>{line}</View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: Spacing[1],
  },
});
