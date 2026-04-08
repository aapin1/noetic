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
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';

type SettingRowProps = {
  label: string;
  description?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
};

function SettingRow({ label, description, onPress, rightElement, destructive }: SettingRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.row}
      disabled={!onPress && !rightElement}
      accessibilityRole={onPress ? 'button' : 'none'}
      accessibilityLabel={label}
    >
      <View style={styles.rowText}>
        <Text
          variant="body"
          style={destructive ? { color: Colors.danger } : undefined}
        >
          {label}
        </Text>
        {description && (
          <Text variant="caption" color="muted">{description}</Text>
        )}
      </View>
      {rightElement ?? (onPress && (
        <ChevronRightIcon size={16} color={Colors.mutedText} />
      ))}
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text variant="label" color="muted" style={styles.sectionHeader}>{title}</Text>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const [notifLikes, setNotifLikes] = useState(true);
  const [notifFollows, setNotifFollows] = useState(true);
  const [notifSimilar, setNotifSimilar] = useState(true);

  const handleSignOut = () => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            signOut();
            router.replace('/');
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={Colors.primaryText} />
        </Pressable>
        <Text style={{ fontFamily: FontFamily.heading, fontSize: 16, color: Colors.primaryText }}>
          Settings
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <Avatar uri={profile?.avatarUrl} displayName={profile?.displayName} size="md" />
          <View style={styles.profileInfo}>
            <Text variant="bodyMedium">{profile?.displayName}</Text>
            <Text variant="monoSmall" color="muted">@{profile?.handle}</Text>
          </View>
          <Pressable
            onPress={() => router.push('/profile/edit' as never)}
            style={styles.editBtn}
            accessibilityLabel="Edit profile"
            accessibilityRole="button"
          >
            <Text variant="monoSmall" color="accent">Edit</Text>
          </Pressable>
        </View>

        <SectionHeader title="Account" />
        <View style={styles.section}>
          <SettingRow
            label="Edit profile"
            onPress={() => router.push('/profile/edit' as never)}
          />
          <SettingRow
            label="Change handle"
            onPress={() => router.push('/profile/edit' as never)}
          />
        </View>

        <SectionHeader title="Notifications" />
        <View style={styles.section}>
          <SettingRow
            label="Likes on reviews"
            rightElement={
              <Switch
                value={notifLikes}
                onValueChange={setNotifLikes}
                trackColor={{ true: Colors.accentGold, false: Colors.inputBorder }}
                thumbColor={Colors.background}
                accessibilityLabel="Toggle likes notifications"
              />
            }
          />
          <SettingRow
            label="New followers"
            rightElement={
              <Switch
                value={notifFollows}
                onValueChange={setNotifFollows}
                trackColor={{ true: Colors.accentGold, false: Colors.inputBorder }}
                thumbColor={Colors.background}
                accessibilityLabel="Toggle follower notifications"
              />
            }
          />
          <SettingRow
            label="Similar taste profiles"
            description="When someone with a similar taste profile joins or updates"
            rightElement={
              <Switch
                value={notifSimilar}
                onValueChange={setNotifSimilar}
                trackColor={{ true: Colors.accentGold, false: Colors.inputBorder }}
                thumbColor={Colors.background}
                accessibilityLabel="Toggle similar taste notifications"
              />
            }
          />
        </View>

        <SectionHeader title="Privacy" />
        <View style={styles.section}>
          <SettingRow
            label="Default visibility"
            description="Set the default visibility for your logs and reviews"
            onPress={() => router.push('/profile/edit' as never)}
          />
        </View>

        <SectionHeader title="About" />
        <View style={styles.section}>
          <SettingRow
            label="Version"
            rightElement={<Text variant="monoSmall" color="muted">1.0.0</Text>}
          />
        </View>

        <View style={styles.signOutContainer}>
          <Pressable
            onPress={handleSignOut}
            style={styles.signOutRow}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <LogOutIcon size={18} color={Colors.danger} />
            <Text variant="body" style={{ color: Colors.danger }}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
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
  content: { paddingBottom: Spacing[12] },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
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
    borderColor: Colors.cardBorder,
    marginBottom: Spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
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
    borderColor: 'rgba(232,108,108,0.3)',
    backgroundColor: 'rgba(232,108,108,0.07)',
  },
});
