import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { MicIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Text } from '@/components/ui/Text';

interface Props {
  /** Receives the transcribed text when the press ends. */
  onText: (text: string) => void;
  onError?: (message: string) => void;
}

/**
 * Press-and-hold to speak; release to transcribe. Same recorder and Whisper
 * endpoint as VoiceNoteButton — the only difference is the gesture: holding
 * maps to "I'm talking now", which needs no explanation the first time a
 * person ever meets the app.
 */
export function HoldToSpeak({ onText, onError }: Props) {
  const c = useThemeColors();
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => () => {
    // Unmount during a recording: release the mic without transcribing. The
    // native shared object may already be gone — guard, don't red-box.
    try {
      if (recorder.isRecording) recorder.stop().catch(() => {});
    } catch {}
  }, [recorder]);

  const start = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        onError?.('microphone permission is needed to speak a thought.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('recording');
    } catch {
      onError?.('could not start recording.');
      setState('idle');
    }
  }, [onError, recorder]);

  const stop = useCallback(async () => {
    if (!recorder.isRecording) {
      setState('idle');
      return;
    }
    setState('transcribing');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error('no recording');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const { text } = await api.captures.transcribe(base64, 'audio/m4a');
      if (text.trim()) onText(text.trim());
    } catch {
      onError?.("couldn't hear that — typing works too.");
    } finally {
      setState('idle');
    }
  }, [onText, onError, recorder]);

  if (state === 'transcribing') {
    return (
      <View style={[styles.btn, { borderColor: c.borderSubtle }]}>
        <LoadingDots size={4} />
      </View>
    );
  }

  const recording = state === 'recording';
  return (
    <Pressable
      onPressIn={() => void start()}
      onPressOut={() => void stop()}
      style={[styles.btn, { borderColor: recording ? c.danger : c.borderSubtle }]}
      accessibilityLabel="Hold to speak a thought"
    >
      <MicIcon size={14} color={recording ? c.danger : c.muted} />
      <Text variant="monoSmall" style={{ color: recording ? c.danger : c.faint }}>
        {recording ? 'listening…' : 'hold to speak'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    borderWidth: 1,
    borderRadius: 17,
    paddingVertical: 8,
    paddingHorizontal: Spacing[3],
  },
});
