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
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function EditProfileScreen() {
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
    if (!displayName.trim()) { setError('Display name is required.'); return; }
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Cancel">
          <ChevronLeftIcon size={22} color={Colors.primaryText} />
        </Pressable>
        <Text style={{ fontFamily: FontFamily.heading, fontSize: 16, color: Colors.primaryText }}>
          Edit profile
        </Text>
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
            <View style={styles.errorBanner}>
              <Text variant="caption" color="danger">{error}</Text>
            </View>
          ) : null}

          {success ? (
            <View style={styles.successBanner}>
              <Text variant="caption" color="success">Profile saved!</Text>
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
            placeholder="What you read, watch, and think about..."
            multiline
            numberOfLines={3}
            hint="Shown on your public profile."
          />

          <Input
            label="Public notes"
            value={publicNotes}
            onChangeText={setPublicNotes}
            placeholder="Anything you want visitors to see..."
            multiline
            numberOfLines={4}
            hint="Optional. Visible to anyone who views your profile."
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
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  backBtn: { padding: Spacing[2] },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[6],
    paddingBottom: Spacing[12],
  },
  errorBanner: {
    backgroundColor: 'rgba(232,108,108,0.1)',
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(232,108,108,0.3)',
  },
  successBanner: {
    backgroundColor: 'rgba(120,211,157,0.1)',
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(120,211,157,0.3)',
  },
  saveBtn: { marginTop: Spacing[4] },
});
