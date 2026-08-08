import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function ResetPasswordScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleReset = async () => {
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('The code is six digits.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.auth.confirmPasswordReset({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        newPassword: password,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
        <View style={styles.doneWrap}>
          <Text variant="wordmark" style={styles.mark}>
            mneme
          </Text>
          <Text variant="h1" style={styles.title}>
            Password updated.
          </Text>
          <Text variant="monoSmall" color="muted" style={styles.subtitle}>
            sign in with the new one.
          </Text>
          <Button
            label="Back to sign in"
            onPress={() => router.replace('/(auth)/sign-in')}
            variant="primary"
            size="lg"
            fullWidth
            style={styles.submitBtn}
            accessibilityLabel="Back to sign in"
          />
        </View>
      </SafeAreaView>
    );
  }

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
              Enter your code.
            </Text>
            <Text variant="monoSmall" color="muted" style={styles.subtitle}>
              check your email — it expires in 15 minutes.
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

            {!params.email && (
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
              />
            )}

            <Input
              testID="reset-code"
              label="Six-digit code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              returnKeyType="next"
            />

            <Input
              testID="reset-password"
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
            />

            <Input
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleReset}
            />

            <Button
              label="Set new password"
              onPress={handleReset}
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              style={styles.submitBtn}
              accessibilityLabel="Set your new password"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    marginTop: Spacing[4],
    marginBottom: Spacing[2],
    alignSelf: 'flex-start',
    padding: Spacing[2],
  },
  header: {
    marginTop: Spacing[6],
    marginBottom: Spacing[8],
  },
  mark: {
    marginBottom: Spacing[8],
  },
  title: { marginBottom: Spacing[2] },
  subtitle: {},
  form: { flex: 1 },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
  },
  submitBtn: { marginTop: Spacing[4] },
  doneWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
});
