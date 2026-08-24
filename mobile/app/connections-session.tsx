import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import type { SessionTarget } from '@/types/api';

/**
 * "Sign in inside mneme." The site opens in a WebView; the person logs in
 * the way they always do; once the URL says they're in, a script served by
 * the backend runs in the page, fetches their own data and posts it back as
 * a file. Nothing about the login ever reaches mneme — only the file, which
 * goes through the ordinary import.
 *
 * react-native-webview is a native module: a dev client built before it was
 * added has no WebView, so the require is guarded and the screen explains.
 */
type WebViewModule = typeof import('react-native-webview');
let WebViewComponent: WebViewModule['WebView'] | null = null;
try {
  WebViewComponent = (require('react-native-webview') as WebViewModule).WebView;
} catch {
  WebViewComponent = null;
}

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

type Phase = 'loading' | 'signin' | 'ready' | 'working' | 'done' | 'error';

export default function ConnectionSessionScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { target: key } = useLocalSearchParams<{ target: string }>();
  const [target, setTarget] = useState<SessionTarget | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const webview = useRef<InstanceType<NonNullable<typeof WebViewComponent>> | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!key) return;
    api.connections
      .session(key)
      .then((t) => {
        setTarget(t);
        setPhase('signin');
      })
      .catch((e) => {
        setPhase('error');
        setMessage(e instanceof Error ? e.message : 'something went wrong');
      });
  }, [key]);

  const runScript = () => {
    if (!target || !webview.current || ran.current) return;
    ran.current = true;
    setPhase('working');
    setMessage(target.working);
    webview.current.injectJavaScript(target.script);
  };

  const onMessage = async (raw: string) => {
    let msg: { type: string; message?: string; filename?: string; text?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'progress') setMessage(msg.message ?? '');
    if (msg.type === 'error') {
      setPhase('error');
      setMessage(msg.message ?? 'something went wrong');
      ran.current = false;
    }
    if (msg.type === 'file' && msg.text) {
      setMessage('handing it to mneme…');
      try {
        await api.importer.start({ content: msg.text, filename: msg.filename, includeBare: true });
        track('connection_linked', { provider: `session:${target?.key ?? key}` });
        setPhase('done');
        router.replace('/import' as never);
      } catch (e) {
        setPhase('error');
        setMessage(e instanceof Error ? e.message : 'could not start the import');
      }
    }
  };

  if (!WebViewComponent) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
        <ScreenHeader title="Sign in" variant="title" />
        <View style={styles.center}>
          <Text variant="serif" style={{ textAlign: 'center' }}>
            this needs a newer build of mneme
          </Text>
          <Text variant="monoSmall" color="faint" style={{ textAlign: 'center', marginTop: Spacing[3], lineHeight: 18 }}>
            signing in inside the app arrived with the next update. until then, the file export works.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={[]}>
      <ScreenHeader title={target?.name ?? 'Sign in'} variant="title" />
      {phase === 'loading' || !target ? (
        <AsciiLoader fill size={90} message={phase === 'error' ? message : 'loading…'} />
      ) : (
        <>
          <View style={[styles.banner, { borderColor: c.border, backgroundColor: c.surface }]}>
            {phase === 'working' || phase === 'done' ? (
              <AsciiLoader inline variant="mail" size={28} message={message} />
            ) : (
              <Text variant="monoSmall" color="muted" style={{ lineHeight: 18, flex: 1 }}>
                {phase === 'error'
                  ? message
                  : phase === 'ready'
                    ? `you're in. mneme will read ${target.what}`
                    : `sign in as you normally would. your password never reaches mneme — only ${target.what}`}
              </Text>
            )}
            {phase === 'ready' || phase === 'error' ? (
              <Button label={phase === 'error' ? 'try again' : 'read it →'} size="sm" variant="secondary" onPress={runScript} style={{ marginLeft: Spacing[3] }} />
            ) : null}
          </View>
          <WebViewComponent
            ref={webview}
            source={{ uri: target.startUrl }}
            userAgent={DESKTOP_UA}
            sharedCookiesEnabled
            incognito={false}
            javaScriptEnabled
            onMessage={(e) => void onMessage(e.nativeEvent.data)}
            onNavigationStateChange={(nav) => {
              if (!nav.loading && new RegExp(target.readyPattern).test(nav.url) && phase === 'signin') setPhase('ready');
            }}
            style={styles.web}
          />
          <Pressable onPress={() => router.back()} style={styles.cancel} hitSlop={8} accessibilityRole="button">
            <Text variant="monoSmall" color="faint">
              cancel
            </Text>
          </Pressable>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: Spacing[8] },
  banner: { flexDirection: 'row', alignItems: 'center', margin: Spacing[4], padding: Spacing[4], borderWidth: 1, borderRadius: Radius.lg },
  web: { flex: 1 },
  cancel: { alignSelf: 'center', padding: Spacing[3] },
});
