import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function EditProfileScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [publicNotes, setPublicNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? '');
      setHandle(profile.handle ?? '');
      setBio(profile.bio ?? '');
      setPublicNotes(profile.publicNotes ?? '');
    }
  }, [profile]);

  const handleSave = async () => {
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (!handle.trim() || !/^[a-zA-Z0-9_]{2,24}$/.test(handle.trim())) {
      setError('Handle must be 2–24 characters: letters, numbers, underscores only.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.profile.update({
        displayName: displayName.trim(),
        handle: handle.trim(),
        bio: bio.trim() || undefined,
        publicNotes: publicNotes.trim() || undefined,
      });
      await refreshProfile();
      setSuccess(true);
      setTimeout(() => router.back(), 600);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save profile. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={[styles.navBar, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Cancel">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="h4">Edit profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={[styles.errorBanner, { borderColor: c.danger, backgroundColor: c.elevated }]}>
              <Text variant="caption" color="danger">
                {error}
              </Text>
            </View>
          ) : null}

          {success ? (
            <View style={[styles.successBanner, { borderColor: c.border, backgroundColor: c.elevated }]}>
              <Text variant="caption" color="primary">
                Saved.
              </Text>
            </View>
          ) : null}

          <Input
            label="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            autoCapitalize="words"
          />

          <Input
            label="Handle"
            value={handle}
            onChangeText={(t) => setHandle(t.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24))}
            placeholder="your_handle"
            autoCapitalize="none"
            hint="2–24 characters. Letters, numbers, underscores only."
          />

          <Input
            label="Bio"
            value={bio}
            onChangeText={setBio}
            placeholder="Optional orientation for the system…"
            multiline
            numberOfLines={3}
          />

          <Input
            label="Notes"
            value={publicNotes}
            onChangeText={setPublicNotes}
            placeholder="Optional. Kept with your account."
            multiline
            numberOfLines={4}
          />

          <Button
            label={saving ? 'Saving…' : 'Save changes'}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            style={styles.saveBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
  },
  backBtn: { padding: Spacing[2] },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[6],
    paddingBottom: Spacing[12],
  },
  errorBanner: {
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
    borderWidth: 1,
  },
  successBanner: {
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
    borderWidth: 1,
  },
  saveBtn: { marginTop: Spacing[4] },
});
