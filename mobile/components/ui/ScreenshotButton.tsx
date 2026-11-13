import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useThemeColors } from '@/contexts/ThemeContext';
import { LoadingDots } from '@/components/ui/LoadingDots';

interface Props {
  /** Receives the text read off the screenshot. */
  onText: (text: string) => void;
  /** `code` is the API error code when the server refused (e.g. USAGE_LIMIT). */
  onError?: (message: string, code?: string) => void;
}

/**
 * Pick a screenshot of a source the scraper couldn't get past (paywall,
 * Facebook/LinkedIn login wall); a vision model reads it server-side and the
 * text comes back for the capture fail-safe box. Sits beside VoiceNoteButton.
 */
export function ScreenshotButton({ onText, onError }: Props) {
  const c = useThemeColors();
  const [reading, setReading] = useState(false);

  const pick = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.6,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      setReading(true);
      const { text } = await api.captures.readScreenshot(asset.base64!, asset.mimeType ?? 'image/jpeg');
      onText(text);
    } catch (e) {
      onError?.(
        e instanceof Error ? e.message : "Couldn't read that screenshot. Try typing instead.",
        (e as { code?: string })?.code,
      );
    } finally {
      setReading(false);
    }
  }, [onText, onError]);

  if (reading) {
    return (
      <Pressable style={[styles.btn, { borderColor: c.borderSubtle }]} disabled>
        <LoadingDots size={4} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={pick}
      style={[styles.btn, { borderColor: c.borderSubtle }]}
      accessibilityLabel="Add a screenshot"
    >
      <ImageIcon size={14} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
