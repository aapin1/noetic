import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeftIcon, ChevronRightIcon, LogOutIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';

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
        <Text variant="body" style={destructive ? { color: c.danger } : undefined}>
          {label}
        </Text>
        {description ? (
          <Text variant="caption" color="muted">
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

export default function SettingsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const [digestWeekly, setDigestWeekly] = useState(true);
  const [captureNudge, setCaptureNudge] = useState(false);

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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.navBar, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="h4">Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.profileCard, { borderBottomColor: c.border }]}>
          <Avatar uri={profile?.avatarUrl} displayName={profile?.displayName} size="md" />
          <View style={styles.profileInfo}>
            <Text variant="bodyMedium">{profile?.displayName}</Text>
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
        </View>

        <SectionHeader title="Capture & insights" />
        <View style={[styles.section, { borderColor: c.border }]}>
          <SettingRow
            label="Weekly summary"
            description="A recap of your drift and what you've been thinking about."
            rightElement={
              <Switch
                value={digestWeekly}
                onValueChange={setDigestWeekly}
                trackColor={{ true: c.text, false: c.borderSubtle }}
                thumbColor={c.surface}
                accessibilityLabel="Toggle weekly summary"
              />
            }
          />
          <SettingRow
            label="Capture reminder"
            description="A quiet nudge if you haven't saved anything in a few days."
            rightElement={
              <Switch
                value={captureNudge}
                onValueChange={setCaptureNudge}
                trackColor={{ true: c.text, false: c.borderSubtle }}
                thumbColor={c.surface}
                accessibilityLabel="Toggle capture reminders"
              />
            }
          />
        </View>

        <SectionHeader title="Privacy" />
        <View style={[styles.section, { borderColor: c.border }]}>
          <SettingRow
            label="Your data stays yours"
            description="Captures and insights are private by default. You can export them through the API, or request a full download once that feature ships."
          />
        </View>

        <SectionHeader title="About" />
        <View style={[styles.section, { borderColor: c.border }]}>
          <SettingRow label="Version" rightElement={<Text variant="monoSmall" color="muted">1.0.0</Text>} />
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
      </ScrollView>
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
});
