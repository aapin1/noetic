import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { AppleSignInButton } from '@/components/auth/AppleSignInButton';

export default function SignInScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!identifier.trim() || !password) {
      setError('Enter your email or username and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signIn(identifier.trim().toLowerCase(), password);
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            onPress={() => router.back()}
            style={styles.back}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <ChevronLeftIcon size={20} color={c.text} />
          </Pressable>

          <View style={styles.header}>
            <Text variant="wordmark" style={styles.mark}>
              mneme
            </Text>
            <Text variant="h1" style={styles.title}>
              Welcome back
            </Text>
          </View>

          <View style={styles.form}>
            {error ? (
              <View style={[styles.errorBanner, { borderColor: c.danger, backgroundColor: c.elevated }]}>
                <Text variant="caption" color="danger">
                  {error}
                </Text>
              </View>
            ) : null}

            <Input
              testID="sign-in-identifier"
              label="Email or username"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="you@example.com or your_handle"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
            />

            <Input
              testID="sign-in-password"
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
            />

            <Button
              label="Sign in"
              onPress={handleSignIn}
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              style={styles.submitBtn}
              accessibilityLabel="Sign in to mneme"
            />

            <Pressable
              onPress={() => router.push('/(auth)/forgot-password')}
              style={styles.forgot}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel="Reset your password"
            >
              <Text variant="subheadline" color="secondary">
                Forgot your password?
              </Text>
            </Pressable>

            <AppleSignInButton onError={setError} onLoadingChange={setLoading} />
          </View>

          <View style={styles.footer}>
            <Text variant="body" color="secondary">
              New here?{' '}
            </Text>
            <Pressable
              onPress={() => router.replace('/(auth)/sign-up')}
              accessibilityRole="link"
              accessibilityLabel="Create an account"
            >
              <Text variant="bodyMedium" color="accent">
                Create an account
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.loadingOverlay, { backgroundColor: c.background }]}>
          <AsciiLoader fill size={110} message={['Waking your brain…', 'Finding your map…']} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
  },
  back: {
    marginTop: Spacing[2],
    marginBottom: Spacing[1],
    alignSelf: 'flex-start',
    padding: Spacing[2],
  },
  header: {
    marginTop: Spacing[2],
    marginBottom: Spacing[5],
  },
  mark: {
    marginBottom: Spacing[5],
  },
  title: {},
  form: {
    flex: 1,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
  },
  submitBtn: {
    marginTop: Spacing[4],
  },
  forgot: {
    alignSelf: 'center',
    marginTop: Spacing[4],
    padding: Spacing[1],
  },
  loadingOverlay: {
    zIndex: 10,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing[8],
  },
});
