import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import type { OwnerProfile } from '@/types/api';

interface Props {
  profile: OwnerProfile | null;
  onChanged: (profile: OwnerProfile) => void;
}

/**
 * The you-page avatar, made tappable. Opens a sheet to pick a new picture
 * (square-cropped natively), take one, or remove the current one. The new URL
 * flows back up through onChanged so every other Avatar picks it up.
 */
export function EditableAvatar({ profile, onChanged }: Props) {
  const c = useThemeColors();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (source: 'camera' | 'library') => {
    setError('');
    setSheetOpen(false);
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError('Camera permission is needed to take a photo.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setError('Photo library permission is needed.');
          return;
        }
      }

      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      };
      const res =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;

      setBusy(true);
      const asset = res.assets[0];
      const { profile: updated } = await api.profile.uploadAvatar(
        asset.base64!,
        asset.mimeType ?? 'image/jpeg',
      );
      onChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your picture.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError('');
    setSheetOpen(false);
    try {
      setBusy(true);
      const { profile: updated } = await api.profile.removeAvatar();
      onChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove your picture.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setSheetOpen(true)}
        accessibilityLabel="Change profile picture"
        disabled={busy}
      >
        <Avatar uri={profile?.avatarUrl} displayName={profile?.displayName} size="xl" />
        <View style={[styles.badge, { backgroundColor: c.text, borderColor: c.background }]}>
          {busy ? (
            <ActivityIndicator size="small" color={c.background} />
          ) : (
            <CameraIcon size={13} color={c.background} />
          )}
        </View>
      </Pressable>

      {error ? (
        <Text variant="monoSmall" color="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <SheetRow label="Choose from library" onPress={() => void pick('library')} />
            <View style={[styles.divider, { backgroundColor: c.borderSubtle }]} />
            <SheetRow label="Take photo" onPress={() => void pick('camera')} />
            {profile?.avatarUrl ? (
              <>
                <View style={[styles.divider, { backgroundColor: c.borderSubtle }]} />
                <SheetRow label="Remove photo" danger onPress={() => void remove()} />
              </>
            ) : null}
            <View style={[styles.divider, { backgroundColor: c.borderSubtle }]} />
            <SheetRow label="Cancel" onPress={() => setSheetOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function SheetRow({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text variant="bodyMedium" color={danger ? 'danger' : 'primary'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    marginTop: Spacing[2],
    textAlign: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    padding: Spacing[4],
  },
  sheet: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  row: {
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[5],
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
