import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

/**
 * The system Sign in with Apple button plus the whole native flow: authorize,
 * exchange the identity token with our backend, then route — new accounts (or
 * ones that never finished onboarding) into the identity step, returning ones
 * straight into the app.
 *
 * Renders nothing on Android or when the capability is unavailable, so both
 * auth screens can include it unconditionally.
 */
export function AppleSignInButton({
  onError,
  onLoadingChange,
}: {
  onError: (message: string) => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const { scheme, colors: c } = useTheme();
  const router = useRouter();
  const { signInWithApple } = useAuth();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let alive = true;
    AppleAuthentication.isAvailableAsync().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!available) return null;

  const handlePress = async () => {
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (e) {
      // Dismissing the sheet is not an error the user needs to read about.
      if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return;
      onError("apple sign-in didn't complete. try again.");
      return;
    }

    if (!credential.identityToken) {
      onError("apple sign-in didn't complete. try again.");
      return;
    }

    // Apple surfaces the name exactly once, on the very first authorization.
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();

    onError('');
    onLoadingChange(true);
    try {
      const { isNewUser, hasHandle } = await signInWithApple({
        identityToken: credential.identityToken,
        fullName: fullName || undefined,
      });
      if (isNewUser || !hasHandle) {
        router.replace('/(onboarding)/identity');
      } else {
        router.replace('/(tabs)');
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "that didn't work. try again.");
    } finally {
      onLoadingChange(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        <Text variant="monoSmall" color="faint" style={styles.dividerText}>
          or
        </Text>
        <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
      </View>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={
          scheme === 'dark'
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
        }
        // Pill radius to sit next to the app's own buttons (Radius.full at 54pt).
        cornerRadius={27}
        style={styles.button}
        onPress={() => void handlePress()}
        testID="apple-sign-in"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing[6] },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing[6],
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { marginHorizontal: Spacing[3] },
  button: { width: '100%', height: 54 },
});
