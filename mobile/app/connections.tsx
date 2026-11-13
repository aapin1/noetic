import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react-native';

import { api } from '@/lib/api';
import { failureReason, track } from '@/lib/analytics';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { InfoModal } from '@/components/ui/InfoModal';
import { ProviderTile } from '@/components/ui/ProviderTile';
import { SectionKicker } from '@/components/ui/SectionKicker';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { GROUP_ORDER, LINKABLE, SESSION_TILES, linkableMeta, type LinkableMeta } from '@/lib/connectionProviders';
import { plainProse, sentenceCase } from '@/lib/text';
import type { Connection, ConnectionProvider, SessionTarget } from '@/types/api';

type Mode = 'ASK' | 'AUTO';

const POLL_MS = 2500;
/** Mirrors FREE_CONNECTION_LIMIT on the server — the server is the enforcer. */
const FREE_LIMIT = 2;

type SessionRow = Omit<SessionTarget, 'script'>;

/** What the bottom sheet is showing, if anything. */
type Sheet =
  | { kind: 'link'; meta: LinkableMeta }
  | { kind: 'session'; target: SessionRow }
  | { kind: 'plus' };

/** One line of the available list: a linkable account or a one-time sign-in. */
type Available = { id: string; name: string; accent: string; what: string };

const MODES: { key: Mode; label: string }[] = [
  { key: 'ASK', label: 'Ask me first' },
  { key: 'AUTO', label: 'Add automatically' },
];

function ago(iso: string | null): string {
  if (!iso) return 'Not checked yet';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 2) return 'Checked just now';
  if (m < 60) return `Checked ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Checked ${h}h ago`;
  return `Checked ${Math.floor(h / 24)}d ago`;
}

function statusLine(conn: Connection): string {
  if (conn.syncing) return 'Reading your account…';
  if (conn.status === 'error' && conn.lastError) return plainProse(conn.lastError);
  const parts = [ago(conn.lastSyncedAt)];
  if (conn.mapped > 0) parts.push(`${conn.mapped} on your map`);
  // Finds waiting for a yes get their own line under the row.
  if (conn.pending > 0) return parts.join(', ');
  if (conn.lastSync && conn.lastSync.seen > 0 && conn.lastSync.withWords === 0) {
    parts.push(`${conn.lastSync.seen} logged, none with your words yet`);
  } else if (conn.lastSync) parts.push('nothing to bring over yet');
  return parts.join(', ');
}

export default function ConnectionsScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { plan } = useEntitlements();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<ConnectionProvider | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  useEffect(() => {
    void api.connections.sessions().then((r) => setSessions(r.targets)).catch(() => {});
  }, []);

  /** Some sites turn servers away but serve phones: fetch here, hand the body to the server. */
  const deviceSync = async (conn: Connection) => {
    if (!conn.deviceFeed) return false;
    try {
      const res = await fetch(conn.deviceFeed.url, { headers: conn.deviceFeed.headers });
      if (!res.ok) throw new Error(`${conn.provider} answered ${res.status}`);
      const feedText = await res.text();
      const r = await api.connections.syncFeed(conn.provider, feedText);
      upsert(r.connection);
      return true;
    } catch (e) {
      Alert.alert('Could not fetch', e instanceof Error ? plainProse(e.message) : 'Try again in a moment.');
      return true;
    }
  };

  useEffect(() => {
    void api.preferences.get().then((p) => setMode(p.connectionsMode ?? 'ASK')).catch(() => setMode('ASK'));
  }, []);
  const chooseMode = (next: Mode) => {
    const prev = mode;
    setMode(next);
    api.preferences.update({ connectionsMode: next }).catch((e) => {
      setMode(prev);
      Alert.alert('Could not save', e instanceof Error ? plainProse(e.message) : 'Try again in a moment.');
    });
  };

  const answerPending = async (provider: ConnectionProvider, action: 'add' | 'decline') => {
    try {
      await api.connections.resolvePending(action, provider);
      await refresh();
    } catch (e) {
      Alert.alert('Could not do that', e instanceof Error ? plainProse(e.message) : 'Try again in a moment.');
    }
  };

  const refresh = useCallback(() => {
    return api.connections
      .list()
      .then((res) => setConnections(res.connections))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [addingFor, setAddingFor] = useState<ConnectionProvider | null>(null);
  const syncing = !!connections?.some((conn) => conn.syncing) || !!connections?.some((conn) => conn.pending > 0 && addingFor === conn.provider);
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [syncing, refresh]);

  const connected = useMemo(() => new Set((connections ?? []).map((x) => x.provider)), [connections]);
  const atFreeLimit = plan === 'FREE' && connected.size >= FREE_LIMIT;

  /** Yours, in grid order — the accent-washed rows at the top of the page. */
  const linked = useMemo(
    () =>
      LINKABLE.filter((p) => connected.has(p.key)).map((p) => ({
        meta: p,
        conn: (connections ?? []).find((x) => x.provider === p.key)!,
      })),
    [connected, connections]
  );

  /**
   * One list, sectioned by what the content is. Linkable accounts and in-app
   * sign-ins sit side by side; already-connected accounts have their rows
   * above and leave the list.
   */
  const sections = useMemo<{ title: string; rows: Available[] }[]>(() => {
    return GROUP_ORDER.map((group) => ({
      title: group,
      rows: [
        ...LINKABLE.filter((p) => p.group === group && !connected.has(p.key)).map((p) => ({
          id: p.key as string,
          name: p.name,
          accent: p.accent,
          what: sentenceCase(p.what),
        })),
        ...sessions
          .filter((t) => SESSION_TILES[t.key]?.group === group)
          .map((t) => ({ id: `session:${t.key}`, ...SESSION_TILES[t.key] })),
      ],
    })).filter((s) => s.rows.length > 0);
  }, [connected, sessions]);

  const pick = (id: string) => {
    if (id.startsWith('session:')) {
      const target = sessions.find((t) => `session:${t.key}` === id);
      if (target) setSheet({ kind: 'session', target });
      return;
    }
    const meta = linkableMeta(id);
    if (!meta) return;
    // One-time sign-ins aren't kept in sync, so only linked accounts count.
    if (atFreeLimit) {
      setSheet({ kind: 'plus' });
      return;
    }
    setErrors((e) => ({ ...e, [meta.key]: '' }));
    setSheet({ kind: 'link', meta });
  };

  const upsert = (conn: Connection) =>
    setConnections((prev) => [...(prev ?? []).filter((p) => p.provider !== conn.provider), conn]);

  const connect = async (provider: ConnectionProvider) => {
    const input = (drafts[provider] ?? '').trim();
    if (!input || busy) return;
    setBusy(provider);
    setErrors((e) => ({ ...e, [provider]: '' }));
    try {
      const res = await api.connections.link(provider, input);
      upsert(res.connection);
      setDrafts((d) => ({ ...d, [provider]: '' }));
      setSheet(null);
      track('connection_linked', { provider });
      if (res.connection.deviceFeed) void deviceSync(res.connection);
    } catch (e) {
      setErrors((errs) => ({ ...errs, [provider]: e instanceof Error ? plainProse(e.message) : 'Something went wrong. Try again.' }));
      track('connection_link_failed', { provider, reason: failureReason(e) });
    } finally {
      setBusy(null);
    }
  };

  const checkNow = async (provider: ConnectionProvider) => {
    const existing = connections?.find((x) => x.provider === provider);
    if (existing?.deviceFeed && (await deviceSync(existing))) return;
    try {
      const res = await api.connections.sync(provider);
      upsert(res.connection);
    } catch (e) {
      Alert.alert('Could not check', e instanceof Error ? plainProse(e.message) : 'Try again in a moment.');
    }
  };

  const disconnect = (conn: Connection) => {
    Alert.alert(`Disconnect ${linkableMeta(conn.provider)?.name ?? conn.provider}?`, 'Nothing leaves your map. Mneme just stops checking this account.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          setConnections((prev) => (prev ?? []).filter((p) => p.provider !== conn.provider));
          void api.connections
            .unlink(conn.provider)
            .then(() => track('connection_unlinked', { provider: conn.provider }))
            .catch(() => void refresh());
        },
      },
    ]);
  };

  const closeSheet = () => setSheet(null);

  /** Check now and Disconnect live behind the row, the way a native list keeps them. */
  const manage = (meta: LinkableMeta, conn: Connection) => {
    const actions = [
      ...(conn.syncing ? [] : [{ text: 'Check now', onPress: () => void checkNow(conn.provider) }]),
      { text: 'Disconnect', style: 'destructive' as const, onPress: () => disconnect(conn) },
      { text: 'Cancel', style: 'cancel' as const, onPress: () => {} },
    ];
    const handle = !meta.secret && conn.handle ? conn.handle : undefined;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: meta.name,
          message: handle,
          options: actions.map((a) => a.text),
          destructiveButtonIndex: actions.length - 2,
          cancelButtonIndex: actions.length - 1,
        },
        (i) => actions[i]?.onPress()
      );
    } else {
      Alert.alert(meta.name, handle, actions);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="Connections" variant="title" />

      {connections === null ? (
        <AsciiLoader fill size={90} message="Loading…" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text variant="subheadline" color="secondary">
            Link an account and what you write there is added to your map automatically.
          </Text>

          {linked.length > 0 && (
            <View style={styles.section}>
              <SectionKicker label="Connected" />
              <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.border }]}>
                {linked.map(({ meta, conn }, i) => (
                  <View key={meta.key} style={i > 0 && [styles.divided, { borderTopColor: c.border }]} testID={`connection-card-${meta.key}`}>
                    <Pressable
                      onPress={() => manage(meta, conn)}
                      style={styles.row}
                      accessibilityRole="button"
                      accessibilityLabel={`${meta.name}, ${statusLine(conn)}`}
                      accessibilityHint="Check now or disconnect"
                    >
                      <ProviderTile name={meta.name} accent={meta.accent} />
                      <View style={styles.rowText}>
                        <Text variant="headline" numberOfLines={1}>{meta.name}</Text>
                        <Text variant="caption" color={conn.status === 'error' && !conn.syncing ? 'danger' : 'muted'} numberOfLines={2}>
                          {statusLine(conn)}
                        </Text>
                      </View>
                      <MoreHorizontalIcon size={18} color={c.muted} />
                    </Pressable>
                    {conn.pending > 0 && !conn.syncing && (
                      <View style={styles.pendingRow}>
                        <Text variant="subheadline" color="secondary" style={styles.rowText}>
                          {`${conn.pending} waiting for your approval`}
                        </Text>
                        <Button label="Skip" variant="tertiary" size="sm" onPress={() => void answerPending(conn.provider, 'decline')} />
                        <Button
                          label="Add"
                          variant="secondary"
                          size="sm"
                          loading={addingFor === conn.provider}
                          onPress={() => { setAddingFor(conn.provider); void answerPending(conn.provider, 'add').finally(() => setAddingFor(null)); }}
                        />
                      </View>
                    )}
                  </View>
                ))}
              </View>

              {/* The one decision: do new finds land by themselves, or wait
                  for a yes. */}
              {mode !== null && (
                <>
                  <SegmentedControl options={MODES} value={mode} onChange={chooseMode} />
                  <Text variant="caption" color="muted">
                    {mode === 'ASK' ? 'New finds wait here until you add them.' : 'New finds go onto your map as they arrive.'}
                  </Text>
                </>
              )}

              {atFreeLimit && (
                <View style={styles.limitRow}>
                  <Text variant="caption" color="muted" style={styles.rowText}>
                    {`Free keeps ${FREE_LIMIT} accounts in sync. Plus keeps them all.`}
                  </Text>
                  <Button label="Get Mneme Plus" variant="secondary" size="sm" onPress={() => router.push('/plus?from=connections' as never)} />
                </View>
              )}
            </View>
          )}

          {sections.map((s) => (
            <View key={s.title} style={styles.section}>
              <SectionKicker label={s.title} />
              <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.border }]}>
                {s.rows.map((r, i) => (
                  <Pressable
                    key={r.id}
                    onPress={() => pick(r.id)}
                    style={[styles.row, i > 0 && [styles.divided, { borderTopColor: c.border }]]}
                    accessibilityRole="button"
                    accessibilityLabel={`Connect ${r.name}, ${r.what}`}
                    testID={`pick-${r.id}`}
                  >
                    <ProviderTile name={r.name} accent={r.accent} />
                    <View style={styles.rowText}>
                      <Text variant="headline" numberOfLines={1}>{r.name}</Text>
                      <Text variant="caption" color="muted" numberOfLines={1}>{r.what}</Text>
                    </View>
                    <ChevronRightIcon size={16} color={c.muted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          <View style={styles.section}>
            <SectionKicker label="From a file" />
            <View style={[styles.group, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Pressable onPress={() => router.push('/import' as never)} style={styles.row} accessibilityRole="button" accessibilityLabel="Import a file">
                <View style={styles.rowText}>
                  <Text variant="headline">Import a file</Text>
                  <Text variant="caption" color="muted" numberOfLines={1}>An export, bookmarks or a list of links</Text>
                </View>
                <ChevronRightIcon size={16} color={c.muted} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      )}

      {/* The connect sheet: one service at a time, built like InfoModal
          (grabber, title, a sentence, full-width buttons). The scrim or
          Cancel puts it away. */}
      <Modal visible={sheet?.kind === 'link' || sheet?.kind === 'session'} transparent animationType="fade" onRequestClose={closeSheet}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
          <Pressable style={sheetStyles.overlay} onPress={closeSheet} accessibilityLabel="Close">
            <Pressable style={[sheetStyles.card, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
              <View style={[sheetStyles.grabber, { backgroundColor: c.border }]} />
              {sheet?.kind === 'link' && (
                <>
                  <Text variant="h4">{sheet.meta.name}</Text>
                  <Text variant="subheadline" color="secondary" style={sheetStyles.body}>
                    {sheet.meta.hint}
                  </Text>
                  <Input
                    value={drafts[sheet.meta.key] ?? ''}
                    onChangeText={(t) => setDrafts((d) => ({ ...d, [sheet.meta.key]: t }))}
                    placeholder={sheet.meta.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={sheet.meta.secret}
                    returnKeyType="done"
                    onSubmitEditing={() => void connect(sheet.meta.key)}
                    error={errors[sheet.meta.key] || undefined}
                    autoFocus
                    accessibilityLabel={`${sheet.meta.name} ${sheet.meta.placeholder}`}
                    testID={`connect-${sheet.meta.key}`}
                  />
                  <View style={sheetStyles.actions}>
                    <Button
                      label={`Connect ${sheet.meta.name}`}
                      fullWidth
                      onPress={() => void connect(sheet.meta.key)}
                      disabled={busy !== null || !(drafts[sheet.meta.key] ?? '').trim()}
                      loading={busy === sheet.meta.key}
                    />
                    <Button label="Cancel" variant="tertiary" fullWidth onPress={closeSheet} />
                  </View>
                </>
              )}

              {sheet?.kind === 'session' && (
                <>
                  <Text variant="h4">{SESSION_TILES[sheet.target.key]?.name ?? sentenceCase(sheet.target.name)}</Text>
                  <Text variant="subheadline" color="secondary" style={sheetStyles.body}>
                    Sign in as usual. Mneme reads your account once and never sees your password.
                  </Text>
                  <View style={sheetStyles.actions}>
                    <Button
                      label="Sign in"
                      fullWidth
                      onPress={() => {
                        const key = sheet.target.key;
                        closeSheet();
                        router.push(`/connections-session?target=${key}` as never);
                      }}
                    />
                    <Button label="Cancel" variant="tertiary" fullWidth onPress={closeSheet} />
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <InfoModal
        visible={sheet?.kind === 'plus'}
        onClose={closeSheet}
        title="Mneme Plus"
        body={`Free keeps ${FREE_LIMIT} accounts in sync. Plus keeps them all.`}
        action={{
          label: 'Get Mneme Plus',
          onPress: () => {
            closeSheet();
            router.push('/plus?from=connections' as never);
          },
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing[5], paddingBottom: Spacing[12], gap: Spacing[6] },
  section: { gap: Spacing[3] },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], minHeight: 60 },
  rowText: { flex: 1, gap: 2 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], paddingHorizontal: Spacing[4], paddingBottom: Spacing[3] },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
});

const sheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,9,7,0.5)',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[10],
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius['2xl'],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[6],
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: Spacing[5] },
  body: { marginTop: Spacing[2], marginBottom: Spacing[4] },
  actions: { marginTop: Spacing[4], gap: Spacing[2] },
});
