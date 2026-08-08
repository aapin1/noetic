import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function ForgotPasswordScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequest = async () => {
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const normalized = email.trim().toLowerCase();
      await api.auth.requestPasswordReset({ email: normalized });
      router.push({ pathname: '/(auth)/reset-password', params: { email: normalized } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
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
              Forgot your password?
            </Text>
            <Text variant="monoSmall" color="muted" style={styles.subtitle}>
              we'll email you a six-digit code.
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
              testID="forgot-email"
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
              returnKeyType="done"
              onSubmitEditing={handleRequest}
            />

            <Button
              label="Send code"
              onPress={handleRequest}
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              style={styles.submitBtn}
              accessibilityLabel="Email me a reset code"
            />

            <Pressable
              onPress={() => router.push({ pathname: '/(auth)/reset-password', params: { email: email.trim().toLowerCase() } })}
              style={styles.haveCode}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel="I already have a code"
            >
              <Text variant="monoSmall" color="muted">
                already have a code?
              </Text>
            </Pressable>
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
  haveCode: {
    alignSelf: 'center',
    marginTop: Spacing[4],
    padding: Spacing[1],
  },
});
