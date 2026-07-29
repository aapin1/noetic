import React from 'react';
import { Appearance, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Last line of defence for a render-time exception.
 *
 * Without this, any uncaught error in any screen unmounts the whole tree and
 * leaves a white screen with no way back — the worst possible failure mode,
 * and one with no telemetry behind it to explain what happened.
 *
 * Deliberately dependency-free: no ThemeProvider, no custom Text, no router.
 * It sits ABOVE the context providers so it still renders if one of them is
 * what threw, which rules out consuming any of their state. Colours come
 * straight off `Appearance` for the same reason.
 */

type Props = { children: React.ReactNode };
type State = { error: Error | null };

const PALETTE = {
  light: { bg: '#F3EFE6', text: '#1A1712', muted: '#6B6357', border: '#D6CFC0' },
  dark: { bg: '#0C0B08', text: '#EDE7DA', muted: '#8A8172', border: '#2A2620' },
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surfaced in TestFlight/device logs. This is the only signal that exists
    // until a crash reporter is wired up.
    console.error('[mneme] uncaught render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const c = PALETTE[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'];

    return (
      <View style={[styles.root, { backgroundColor: c.bg }]}>
        <Text style={[styles.title, { color: c.text }]}>Something broke.</Text>
        <Text style={[styles.body, { color: c.muted }]}>
          That screen hit an error it couldn&apos;t recover from. Your captures are
          safe — they live on the server, not in the app.
        </Text>
        <Pressable
          onPress={() => this.setState({ error: null })}
          style={[styles.button, { borderColor: c.border }]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={[styles.buttonText, { color: c.text }]}>try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 20, marginBottom: 12, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
  button: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, paddingHorizontal: 28 },
  buttonText: { fontSize: 13, letterSpacing: 1 },
});
