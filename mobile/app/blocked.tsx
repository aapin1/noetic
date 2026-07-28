import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type { BlockedUser } from '@/types/api';

/**
 * The other half of blocking. Guideline 1.2 only asks for the block itself, but
 * a block a user cannot see or undo is a trap — this is where it stays
 * reversible.
 */
export default function BlockedAccountsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { data, loading, error, refetch } = useApiQuery(() => api.moderation.blocked(), []);

  // Unblocking is optimistic, but the source of truth stays the query. Tracking
  // the removed ids separately keeps that true: a failed unblock just drops the
  // id again and the row reappears, with no second copy of the list to reconcile.
  const [removed, setRemoved] = useState<string[]>([]);
  const users = useMemo(
    () => (data?.users ?? []).filter((u) => !removed.includes(u.id)),
    [data, removed],
  );

  const unblock = (user: BlockedUser) => {
    Alert.alert(
      `Unblock ${user.displayName}?`,
      'You will be able to find each other again. This does not restore any follow.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () => {
            setRemoved((prev) => [...prev, user.id]);
            void api.moderation.unblock(user.id).catch((e: unknown) => {
              setRemoved((prev) => prev.filter((id) => id !== user.id));
              Alert.alert(
                'Could not unblock',
                e instanceof Error ? e.message : 'Try again in a moment.',
              );
              void refetch();
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.navBar, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="h4">Blocked</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && !data ? (
        <AsciiLoader fill size={90} message="loading…" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {error ? (
            <Text variant="caption" color="danger" style={styles.empty}>
              {error}
            </Text>
          ) : users.length === 0 ? (
            <Text variant="monoSmall" color="muted" style={styles.empty}>
              you haven't blocked anyone.
            </Text>
          ) : (
            users.map((user) => (
              <View key={user.id} style={[styles.row, { borderBottomColor: c.borderSubtle }]}>
                <Avatar uri={user.avatarUrl} displayName={user.displayName} size="sm" />
                <View style={styles.meta}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {user.displayName}
                  </Text>
                  <Text variant="monoSmall" style={{ color: c.faint }} numberOfLines={1}>
                    @{user.handle}
                  </Text>
                </View>
                <Pressable
                  onPress={() => unblock(user)}
                  hitSlop={8}
                  style={[styles.unblockBtn, { borderColor: c.text }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${user.displayName}`}
                >
                  <Text variant="monoSmall" style={{ color: c.text }}>
                    unblock
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
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
  content: { paddingBottom: Spacing[12] },
  empty: { textAlign: 'center', marginTop: Spacing[10], paddingHorizontal: Spacing[6] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  meta: { flex: 1 },
  unblockBtn: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
  },
});
