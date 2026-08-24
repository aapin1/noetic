import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

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
import { Mark, ProviderGrid, type ProviderSection } from '@/components/ui/ProviderGrid';
import { GROUP_ORDER, LINKABLE, SESSION_TILES, linkableMeta, type LinkableMeta } from '@/lib/connectionProviders';
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

function ago(iso: string | null): string {
  if (!iso) return 'not yet checked';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 2) return 'checked just now';
  if (m < 60) return `checked ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `checked ${h}h ago`;
  return `checked ${Math.floor(h / 24)}d ago`;
}

function statusLine(conn: Connection): string {
  if (conn.syncing) return 'reading your account…';
  if (conn.status === 'error' && conn.lastError) return conn.lastError;
  const parts = [ago(conn.lastSyncedAt)];
  if (conn.mapped > 0) parts.push(`${conn.mapped} on your map`);
  if (conn.pending > 0) parts.push(`${conn.pending} waiting`);
  else if (conn.lastSync && conn.lastSync.seen > 0 && conn.lastSync.withWords === 0) {
    parts.push(`${conn.lastSync.seen} logged, none with your words yet`);
  } else if (conn.lastSync) parts.push('nothing to bring over yet');
  return parts.join(' · ');
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
      Alert.alert('Could not fetch', e instanceof Error ? e.message : 'Try again in a moment.');
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
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again in a moment.');
    });
  };

  const answerPending = async (provider: ConnectionProvider, action: 'add' | 'decline') => {
    try {
      await api.connections.resolvePending(action, provider);
      await refresh();
    } catch (e) {
      Alert.alert('Could not do that', e instanceof Error ? e.message : 'Try again in a moment.');
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
   * One grid, delineated by what the content is. Linkable accounts and
   * in-app sign-ins sit side by side; already-connected accounts have their
   * rows above and leave the grid.
   */
  const sections = useMemo<ProviderSection[]>(() => {
    return GROUP_ORDER.map((group) => ({
      title: group,
      marks: [
        ...LINKABLE.filter((p) => p.group === group && !connected.has(p.key)).map((p) => ({
          id: p.key as string,
          mark: p.key as string,
          name: p.name,
          accent: p.accent,
        })),
        ...sessions
          .filter((t) => SESSION_TILES[t.key]?.group === group)
          .map((t) => ({
            id: `session:${t.key}`,
            mark: t.key,
            name: SESSION_TILES[t.key].name,
            accent: SESSION_TILES[t.key].accent,
          })),
      ],
    }));
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
      setErrors((errs) => ({ ...errs, [provider]: e instanceof Error ? e.message : 'something went wrong — try again' }));
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
      Alert.alert('Could not check', e instanceof Error ? e.message : 'Try again in a moment.');
    }
  };

  const disconnect = (conn: Connection) => {
    Alert.alert(`Disconnect ${conn.provider}?`, 'Nothing leaves your map. Mneme just stops checking this account.', [
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title="Connections" variant="title" />

      {connections === null ? (
        <AsciiLoader fill size={90} message="loading…" />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text variant="monoSmall" color="muted" style={styles.intro}>
            what you write elsewhere, landing on your map on its own.
          </Text>

          {linked.map(({ meta, conn }) => (
            <View key={meta.key} style={[styles.row, { borderColor: c.border, backgroundColor: c.surface }]} testID={`connection-card-${meta.key}`}>
              <View style={styles.rowMain}>
                <View style={[styles.rowTile, { borderColor: `${meta.accent}55`, backgroundColor: `${meta.accent}1C` }]}>
                  <Mark mark={meta.key} color={meta.accent} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.rowHead}>
                    <Text variant="serif">{meta.name}</Text>
                    {!meta.secret && conn.handle ? (
                      <Text variant="monoSmall" color="faint" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {conn.handle}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="monoSmall" color={conn.status === 'error' && !conn.syncing ? 'danger' : 'faint'} numberOfLines={2}>
                    {statusLine(conn)}
                  </Text>
                </View>
                {!conn.syncing && (
                  <Pressable onPress={() => void checkNow(conn.provider)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Check ${meta.name} now`}>
                    <Text variant="monoSmall" color="muted" style={styles.rowGlyph}>↻</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => disconnect(conn)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Disconnect ${meta.name}`}>
                  <Text variant="monoSmall" color="faint" style={styles.rowGlyph}>✕</Text>
                </Pressable>
              </View>
              {conn.pending > 0 && !conn.syncing && (
                <View style={[styles.pendingRow, { borderColor: c.border }]}>
                  <Text variant="monoSmall" color="primary" style={{ flex: 1 }}>
                    {`${conn.pending} waiting for a yes`}
                  </Text>
                  <Pressable
                    onPress={() => { setAddingFor(conn.provider); void answerPending(conn.provider, 'add').finally(() => setAddingFor(null)); }}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text variant="monoSmall" color="primary">{addingFor === conn.provider ? 'adding…' : 'add them'}</Text>
                  </Pressable>
                  <Pressable onPress={() => void answerPending(conn.provider, 'decline')} hitSlop={8} accessibilityRole="button">
                    <Text variant="monoSmall" color="faint">not these</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

          {/* The one decision: do new finds land by themselves, or wait for a
              yes. Shown once anything is connected. */}
          {connected.size > 0 && mode !== null && (
            <View style={[styles.modeRow, { borderColor: c.border }]}>
              <Text variant="monoSmall" color="muted" style={{ flex: 1 }}>
                new finds
              </Text>
              {(['ASK', 'AUTO'] as Mode[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => chooseMode(m)}
                  hitSlop={6}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mode === m }}
                  style={[styles.modePill, { borderColor: mode === m ? c.text : c.border, backgroundColor: mode === m ? c.elevated : 'transparent' }]}
                >
                  <Text variant="monoSmall" color={mode === m ? 'primary' : 'muted'}>
                    {m === 'ASK' ? 'ask me first' : 'add on their own'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {atFreeLimit && (
            <Pressable onPress={() => router.push('/plus?from=connections' as never)} hitSlop={6} accessibilityRole="button">
              <Text variant="monoSmall" color="faint" style={{ textAlign: 'center' }}>
                {`${connected.size} of ${FREE_LIMIT} in sync on free · plus keeps them all →`}
              </Text>
            </Pressable>
          )}

          <ProviderGrid sections={sections} onPick={pick} />

          <Pressable onPress={() => router.push('/import' as never)} hitSlop={8} accessibilityRole="link" style={{ marginTop: Spacing[4] }}>
            <Text variant="monoSmall" color="muted" style={{ textAlign: 'center' }}>
              {'have an export file instead? bring it over →'}
            </Text>
          </Pressable>
        </ScrollView>
      )}

      {/* The connect sheet: one service at a time, risen over the grid rather
          than wedged into it. Tapping the dim puts it away. */}
      <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={closeSheet}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={sheetStyles.overlay} onPress={closeSheet} accessibilityLabel="Close">
            <Pressable style={[sheetStyles.card, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
              {sheet?.kind === 'link' && (
                <>
                  <View style={sheetStyles.head}>
                    <View style={[styles.rowTile, { borderColor: `${sheet.meta.accent}55`, backgroundColor: `${sheet.meta.accent}1C` }]}>
                      <Mark mark={sheet.meta.key} color={sheet.meta.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="serif">{sheet.meta.name}</Text>
                      <Text variant="monoSmall" color="faint">{sheet.meta.what}</Text>
                    </View>
                  </View>
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
                  <Button
                    label={busy === sheet.meta.key ? 'checking…' : 'connect'}
                    variant="secondary"
                    size="sm"
                    accent={sheet.meta.accent}
                    onPress={() => void connect(sheet.meta.key)}
                    disabled={busy !== null || !(drafts[sheet.meta.key] ?? '').trim()}
                    loading={busy === sheet.meta.key}
                    style={sheetStyles.cta}
                  />
                  <Text variant="monoSmall" color="faint" style={sheetStyles.hint}>
                    {sheet.meta.hint}
                  </Text>
                </>
              )}

              {sheet?.kind === 'session' && (
                <>
                  <View style={sheetStyles.head}>
                    <View style={[styles.rowTile, { borderColor: `${SESSION_TILES[sheet.target.key]?.accent ?? '#888888'}55`, backgroundColor: `${SESSION_TILES[sheet.target.key]?.accent ?? '#888888'}1C` }]}>
                      <Mark mark={sheet.target.key} color={SESSION_TILES[sheet.target.key]?.accent ?? c.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="serif">{sheet.target.name}</Text>
                      <Text variant="monoSmall" color="faint">{sheet.target.what}</Text>
                    </View>
                  </View>
                  <Button
                    label="sign in →"
                    variant="secondary"
                    size="sm"
                    accent={SESSION_TILES[sheet.target.key]?.accent}
                    onPress={() => {
                      const key = sheet.target.key;
                      closeSheet();
                      router.push(`/connections-session?target=${key}` as never);
                    }}
                    style={sheetStyles.cta}
                  />
                  <Text variant="monoSmall" color="faint" style={sheetStyles.hint}>
                    you sign in as usual, on your phone — mneme reads it once.
                  </Text>
                </>
              )}

              {sheet?.kind === 'plus' && (
                <>
                  <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2 }}>
                    MNEME PLUS
                  </Text>
                  <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
                    free keeps two accounts in sync. plus keeps them all.
                  </Text>
                  <Button
                    label="get mneme plus →"
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      closeSheet();
                      router.push('/plus?from=connections' as never);
                    }}
                    style={sheetStyles.cta}
                  />
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing[6], paddingBottom: Spacing[12], gap: Spacing[3] },
  intro: { lineHeight: 20, marginBottom: Spacing[2] },
  row: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing[4], gap: Spacing[2] },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing[2] },
  rowTile: { width: 44, height: 44, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowGlyph: { fontSize: 15, padding: Spacing[1] },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[3], borderTopWidth: 1, borderBottomWidth: 1 },
  modePill: { borderWidth: 1, borderRadius: Radius.full, paddingVertical: 5, paddingHorizontal: Spacing[3] },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[4], paddingTop: Spacing[2], borderTopWidth: 1 },
});

const sheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,9,7,0.5)',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing[5],
    paddingBottom: Spacing[10],
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[6],
    gap: Spacing[4],
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  cta: { alignSelf: 'flex-start' },
  hint: { lineHeight: 18 },
});
