import React, { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRightIcon, ExternalLinkIcon, LogOutIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { api } from '@/lib/api';
import { presentCustomerCenter } from '@/lib/purchases';
import { throwTestCrash } from '@/lib/analytics';
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL } from '@/constants/links';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme, useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Avatar } from '@/components/ui/Avatar';
import { AsciiLoader } from '@/components/ui/AsciiLoader';

type SettingRowProps = {
  label: string;
  description?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
};

function SettingRow({ label, description, onPress, rightElement, destructive }: SettingRowProps) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderBottomColor: c.borderSubtle, backgroundColor: c.surface }]}
      disabled={!onPress && !rightElement}
      accessibilityRole={onPress ? 'button' : 'none'}
      accessibilityLabel={label}
    >
      <View style={styles.rowText}>
        <Text variant="serif" style={destructive ? { color: c.danger } : undefined}>
          {label}
        </Text>
        {description ? (
          <Text variant="monoSmall" color="faint" numberOfLines={1} style={styles.rowDescription}>
            {description}
          </Text>
        ) : null}
      </View>
      {rightElement ?? (onPress && <ChevronRightIcon size={16} color={c.muted} />)}
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text variant="label" color="muted" style={styles.sectionHeader}>
      {title}
    </Text>
  );
}

const THEME_MODES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

/** Three-way theme picker. `system` follows the OS, which only works because
 * app.json declares userInterfaceStyle "automatic" — pinned to "light" it made
 * `useColorScheme()` a constant and this control a no-op. */
function ThemePicker() {
  const c = useThemeColors();
  const { mode, setMode } = useTheme();
  return (
    <View style={[styles.segmented, { borderColor: c.border }]}>
      {THEME_MODES.map((option) => {
        const on = mode === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => setMode(option.value)}
            style={[styles.segment, on && { backgroundColor: c.elevated }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${option.label} theme`}
          >
            <Text variant="monoSmall" color={on ? 'primary' : 'muted'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { granted: pushGranted, requestPermission, refreshPermission } = useNotifications();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  // Returning from the OS settings app only backgrounds this screen, so re-read
  // on focus — otherwise the row still reads "Off" immediately after the user
  // turned it on, which is the one moment the label has to be right.
  useFocusEffect(
    useCallback(() => {
      void refreshPermission();
    }, [refreshPermission]),
  );

  const handleNotifications = async () => {
    if (pushGranted) {
      await Linking.openSettings();
      return;
    }
    // iOS shows its permission prompt at most once per install, and the in-app
    // primer may already have spent it. After that requestPermissionsAsync
    // resolves "denied" without displaying anything, so the OS settings app is
    // the only way back — this row exists precisely to make that reachable.
    const ok = await requestPermission();
    if (!ok) await Linking.openSettings();
  };

  const handleSignOut = () => {
    Alert.alert('Sign out', 'End this session on this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  };

  // Export writes both renderings to the cache dir, then lets the user pick a
  // format — the share sheet can only carry one file at a time.
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await api.account.export();
      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!dir) throw new Error('No writable directory on this device.');
      const jsonPath = `${dir}mneme-export.json`;
      const mdPath = `${dir}mneme-export.md`;
      const { markdown, ...structured } = data;
      await FileSystem.writeAsStringAsync(jsonPath, JSON.stringify(structured, null, 2));
      await FileSystem.writeAsStringAsync(mdPath, markdown);
      setExporting(false);
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'This device can’t open the share sheet.');
        return;
      }
      const count = data.captureCount;
      Alert.alert(
        'Export ready',
        `${count} capture${count === 1 ? '' : 's'}, yours to keep. Pick a format.`,
        [
          {
            text: 'Markdown',
            onPress: () =>
              void Sharing.shareAsync(mdPath, {
                mimeType: 'text/markdown',
                UTI: 'net.daringfireball.markdown',
                dialogTitle: 'Export your data',
              }),
          },
          {
            text: 'JSON',
            onPress: () =>
              void Sharing.shareAsync(jsonPath, {
                mimeType: 'application/json',
                UTI: 'public.json',
                dialogTitle: 'Export your data',
              }),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } catch (e) {
      setExporting(false);
      Alert.alert('Could not export', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };

  // Two-step confirm for permanent account deletion (App Store requires the
  // option; the double confirmation keeps a stray tap from ending a life's
  // worth of captures).
  const [deleting, setDeleting] = useState(false);
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently erases your account and everything you have saved. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Are you sure?', 'Your entire map will be gone forever.', [
              { text: 'Keep my account', style: 'cancel' },
              {
                text: 'Delete everything',
                style: 'destructive',
                onPress: async () => {
                  setDeleting(true);
                  try {
                    await api.account.delete();
                    await signOut();
                    router.replace('/');
                  } catch (e) {
                    setDeleting(false);
                    Alert.alert(
                      'Could not delete account',
                      e instanceof Error ? e.message : 'Something went wrong. Try again.',
                    );
                  }
                },
              },
            ]);
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="Settings" variant="title" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.profileCard, { borderBottomColor: c.border }]}>
          <Avatar uri={profile?.avatarUrl} displayName={profile?.displayName} size="md" />
          <View style={styles.profileInfo}>
            <Text variant="serif">{profile?.displayName}</Text>
            <Text variant="monoSmall" color="muted">
              @{profile?.handle}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/profile/edit' as never)}
            style={styles.editBtn}
            accessibilityLabel="Edit profile"
            accessibilityRole="button"
          >
            <Text variant="monoSmall" color="accent">
              Edit
            </Text>
          </Pressable>
        </View>

        <SectionHeader title="Account" />
        <View style={[styles.section, { borderColor: c.border }]}>
          <SettingRow label="Profile & handle" onPress={() => router.push('/profile/edit' as never)} />
          <SettingRow
            label="Mneme Plus"
            description="Remove ads and unlock every limit."
            onPress={() => router.push('/plus?from=settings' as never)}
          />
          <SettingRow
            label="Manage subscription"
            description="Change plan, restore, or cancel."
            onPress={() => {
              void presentCustomerCenter().then((shown) => {
                if (!shown) {
                  Alert.alert(
                    'Not available',
                    'Subscription management needs an updated app build. You can also manage subscriptions in iOS Settings.',
                  );
                }
              });
            }}
          />
          <SettingRow
            label="Export my data"
            description="Every capture you’ve saved, as a file you keep."
            onPress={() => void handleExport()}
          />
          <SettingRow
            label="Delete account"
            description="Permanently erase your account and data."
            onPress={handleDeleteAccount}
            destructive
          />
        </View>

        <SectionHeader title="Appearance" />
        <View style={[styles.section, { borderColor: c.border }]}>
          <View style={[styles.row, { borderBottomColor: c.borderSubtle, backgroundColor: c.surface }]}>
            <View style={styles.rowText}>
              <Text variant="serif">Theme</Text>
            </View>
            <ThemePicker />
          </View>
        </View>

        <SectionHeader title="Notifications" />
        <View style={[styles.section, { borderColor: c.border }]}>
          <SettingRow
            label="Push notifications"
            description={
              pushGranted
                ? 'On — resurfacing, streaks, and replies.'
                : 'Off — turn them on for resurfacing, streaks, and replies.'
            }
            onPress={() => void handleNotifications()}
            rightElement={
              pushGranted ? <ExternalLinkIcon size={16} color={c.muted} /> : undefined
            }
          />
          <SettingRow
            label="What arrives, and when"
            description="Choose categories and quiet hours."
            onPress={() => router.push('/notification-settings' as never)}
          />
        </View>

        <SectionHeader title="Privacy" />
        <View style={[styles.section, { borderColor: c.border }]}>
          {/* This used to read "your captures are private by default", which was
              not true: Pulse shows your capture titles and key ideas to anyone
              who follows you. Say what actually happens. */}
          <SettingRow
            label="Who can see your captures"
            description="Only you — except that people who follow you see your titles in Pulse."
          />
          <SettingRow
            label="Blocked accounts"
            description="People you've blocked, and how to undo it."
            onPress={() => router.push('/blocked' as never)}
          />
          <SettingRow
            label="Privacy policy"
            description="What we collect, and how your captures are processed."
            onPress={() => void Linking.openURL(PRIVACY_URL)}
            rightElement={<ExternalLinkIcon size={16} color={c.muted} />}
          />
        </View>

        <SectionHeader title="About" />
        <View style={[styles.section, { borderColor: c.border }]}>
          <SettingRow
            label="Terms of use"
            onPress={() => void Linking.openURL(TERMS_URL)}
            rightElement={<ExternalLinkIcon size={16} color={c.muted} />}
          />
          <SettingRow
            label="Support"
            description="Questions, bugs, or anything else."
            onPress={() => void Linking.openURL(SUPPORT_URL)}
            rightElement={<ExternalLinkIcon size={16} color={c.muted} />}
          />
          <SettingRow
            label="Version"
            rightElement={<Text variant="monoSmall" color="muted">{appVersion}</Text>}
          />
        </View>

        <View style={styles.signOutContainer}>
          <Pressable
            onPress={handleSignOut}
            style={[
              styles.signOutRow,
              { borderColor: c.danger, backgroundColor: c.elevated },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <LogOutIcon size={18} color={c.danger} />
            <Text variant="body" style={{ color: c.danger }}>
              Sign out
            </Text>
          </Pressable>
        </View>

        {/* Dev builds only — stripped from every release bundle by the
            `__DEV__` guard. The one reliable way to confirm that Sentry is
            wired, reachable, and symbolicating before trusting it to report a
            real crash. */}
        {__DEV__ && (
          <View style={styles.section}>
            <SettingRow
              label="Trigger a test crash"
              description="Dev only. Verifies Sentry reporting."
              onPress={throwTestCrash}
              destructive
            />
          </View>
        )}
      </ScrollView>
      {deleting && (
        <View style={[StyleSheet.absoluteFill, styles.deletingOverlay, { backgroundColor: c.background }]}>
          <AsciiLoader fill size={100} message="deleting your account…" />
        </View>
      )}
      {exporting && (
        <View style={[StyleSheet.absoluteFill, styles.deletingOverlay, { backgroundColor: c.background }]}>
          <AsciiLoader fill size={100} message="packing up your map…" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
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
  content: { paddingBottom: Spacing[12] },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[5],
    borderBottomWidth: 1,
    marginBottom: Spacing[4],
  },
  profileInfo: { flex: 1 },
  editBtn: {
    padding: Spacing[2],
  },
  sectionHeader: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[2],
  },
  section: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: Spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  rowText: { flex: 1, marginRight: Spacing[3] },
  rowDescription: { marginTop: Spacing[1] },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  segment: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
  },
  signOutContainer: {
    marginHorizontal: Spacing[6],
    marginTop: Spacing[4],
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  deletingOverlay: { zIndex: 10 },
});
