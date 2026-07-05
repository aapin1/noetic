import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { MicIcon, SquareIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useThemeColors } from '@/contexts/ThemeContext';
import { LoadingDots } from '@/components/ui/LoadingDots';

interface Props {
  /** Receives the transcribed text when a recording finishes. */
  onText: (text: string) => void;
  /** Surfaces recording/transcription errors to the host form. */
  onError?: (message: string) => void;
}

/**
 * Tap to record a voice note, tap again to stop; the audio is transcribed
 * server-side (Whisper) and handed back as text. Used by the capture fail-safe
 * ("what was this about?") so the user can speak instead of type.
 */
export function VoiceNoteButton({ onText, onError }: Props) {
  const c = useThemeColors();
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => () => {
    // Unmount during a recording: release the mic without transcribing.
    recordingRef.current?.stopAndUnloadAsync().catch(() => {});
  }, []);

  const start = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        onError?.('Microphone permission is needed to record.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setState('recording');
    } catch {
      onError?.('Could not start recording.');
      setState('idle');
    }
  }, [onError]);

  const stop = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      setState('idle');
      return;
    }
    setState('transcribing');
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      if (!uri) throw new Error('no recording');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const { text } = await api.captures.transcribe(base64, 'audio/m4a');
      onText(text);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not transcribe that — try typing instead.');
    } finally {
      setState('idle');
    }
  }, [onText, onError]);

  if (state === 'transcribing') {
    return (
      <Pressable style={[styles.btn, { borderColor: c.borderSubtle }]} disabled>
        <LoadingDots size={4} />
      </Pressable>
    );
  }

  const recording = state === 'recording';
  return (
    <Pressable
      onPress={recording ? stop : start}
      style={[styles.btn, { borderColor: recording ? c.danger : c.borderSubtle }]}
      accessibilityLabel={recording ? 'Stop recording' : 'Record a voice note'}
    >
      {recording
        ? <SquareIcon size={14} color={c.danger} fill={c.danger} />
        : <MicIcon size={14} color={c.muted} />}
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
