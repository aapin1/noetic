import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react-native';

import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useNotifications } from '@/contexts/NotificationContext';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type { UserPreference } from '@/types/api';

type PushPatch = Partial<
  Pick<
    UserPreference,
    'pushSocial' | 'pushResurface' | 'pushStreak' | 'quietHoursStartHour' | 'quietHoursEndHour'
  >
>;

function hh(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function OnOff({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.toggle, { borderColor: value ? c.text : c.border }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <Text variant="monoSmall" color={value ? 'primary' : 'muted'}>
        {value ? 'on' : 'off'}
      </Text>
    </Pressable>
  );
}

function HourStepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.stepper, { borderColor: c.border }]}>
      <Pressable
        hitSlop={8}
        onPress={() => onChange((value + 23) % 24)}
        accessibilityRole="button"
        accessibilityLabel={`${label}, one hour earlier`}
      >
        <ChevronLeftIcon size={14} color={c.muted} />
      </Pressable>
      <Text variant="monoSmall">{hh(value)}</Text>
      <Pressable
        hitSlop={8}
        onPress={() => onChange((value + 1) % 24)}
        accessibilityRole="button"
        accessibilityLabel={`${label}, one hour later`}
      >
        <ChevronRightIcon size={14} color={c.muted} />
      </Pressable>
    </View>
  );
}

function PrefRow({
  label,
  description,
  rightElement,
}: {
  label: string;
  description: string;
  rightElement: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.row, { borderBottomColor: c.borderSubtle, backgroundColor: c.surface }]}>
      <View style={styles.rowText}>
        <Text variant="serif">{label}</Text>
        <Text variant="monoSmall" color="faint" numberOfLines={2} style={styles.rowDescription}>
          {description}
        </Text>
      </View>
      {rightElement}
    </View>
  );
}

/**
 * The categories and quiet hours the backend already enforces
 * (src/server/services/notification-policy.ts) — this screen only edits the
 * columns that policy reads. Hours are whole local hours; start === end is how
 * the policy spells "quiet hours off".
 */
export default function NotificationSettingsScreen() {
  const c = useThemeColors();
  const { granted: pushGranted } = useNotifications();
  const { data, loading, refetch } = useApiQuery(() => api.preferences.get(), [], {
    cacheKey: 'preferences',
  });

  // Edits apply optimistically; the query stays the source of truth. A failed
  // save drops the override so the row snaps back, then refetches to be sure.
  const [overrides, setOverrides] = useState<PushPatch>({});
  const view = {
    pushSocial: overrides.pushSocial ?? data?.pushSocial ?? true,
    pushResurface: overrides.pushResurface ?? data?.pushResurface ?? true,
    pushStreak: overrides.pushStreak ?? data?.pushStreak ?? true,
    quietHoursStartHour: overrides.quietHoursStartHour ?? data?.quietHoursStartHour ?? 21,
    quietHoursEndHour: overrides.quietHoursEndHour ?? data?.quietHoursEndHour ?? 9,
  };

  const apply = (patch: PushPatch) => {
    setOverrides((prev) => ({ ...prev, ...patch }));
    void api.preferences.update(patch).catch((e: unknown) => {
      setOverrides((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(patch) as (keyof PushPatch)[]) delete next[key];
        return next;
      });
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again in a moment.');
      void refetch();
    });
  };

  const quietOff = view.quietHoursStartHour === view.quietHoursEndHour;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="Notifications" variant="title" />

      {loading && !data ? (
        <AsciiLoader fill size={90} message="loading…" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {!pushGranted && (
            <Pressable
              onPress={() => void Linking.openSettings()}
              style={[styles.notice, { borderColor: c.border, backgroundColor: c.elevated }]}
              accessibilityRole="button"
              accessibilityLabel="Open iOS notification settings"
            >
              <Text variant="monoSmall" color="muted">
                push is off at the system level — nothing below can arrive until you turn it on in
                iOS Settings. →
              </Text>
            </Pressable>
          )}

          <Text variant="label" color="muted" style={styles.sectionHeader}>
            What arrives
          </Text>
          <View style={[styles.section, { borderColor: c.border }]}>
            <PrefRow
              label="Social"
              description="Follows, likes, and replies from people."
              rightElement={
                <OnOff
                  value={view.pushSocial}
                  onChange={(next) => apply({ pushSocial: next })}
                  label="Social notifications"
                />
              }
            />
            <PrefRow
              label="Resurfacing"
              description="When something you saved disagrees, picks up, or has gone quiet."
              rightElement={
                <OnOff
                  value={view.pushResurface}
                  onChange={(next) => apply({ pushResurface: next })}
                  label="Resurfacing notifications"
                />
              }
            />
            <PrefRow
              label="Streaks"
              description="Only the note that a freeze held your streak. Never a warning."
              rightElement={
                <OnOff
                  value={view.pushStreak}
                  onChange={(next) => apply({ pushStreak: next })}
                  label="Streak notifications"
                />
              }
            />
          </View>

          <Text variant="label" color="muted" style={styles.sectionHeader}>
            Quiet hours
          </Text>
          <View style={[styles.section, { borderColor: c.border }]}>
            <PrefRow
              label="From"
              description="Pushes stop arriving at this hour."
              rightElement={
                <HourStepper
                  value={view.quietHoursStartHour}
                  onChange={(next) => apply({ quietHoursStartHour: next })}
                  label="Quiet hours start"
                />
              }
            />
            <PrefRow
              label="Until"
              description="Anything held overnight arrives after this hour."
              rightElement={
                <HourStepper
                  value={view.quietHoursEndHour}
                  onChange={(next) => apply({ quietHoursEndHour: next })}
                  label="Quiet hours end"
                />
              }
            />
          </View>
          <Text variant="monoSmall" color="faint" style={styles.footnote}>
            {quietOff
              ? 'same start and end — quiet hours are off.'
              : `pushes hold from ${hh(view.quietHoursStartHour)} to ${hh(view.quietHoursEndHour)}, your local time. nothing is dropped — it waits.`}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: Spacing[12] },
  notice: {
    marginHorizontal: Spacing[4],
    marginTop: Spacing[4],
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing[4],
  },
  sectionHeader: {
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[6],
    marginBottom: Spacing[2],
  },
  section: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  rowText: { flex: 1 },
  rowDescription: { marginTop: 2 },
  toggle: {
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    minWidth: 44,
    alignItems: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.xs,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
  },
  footnote: {
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[3],
  },
});
