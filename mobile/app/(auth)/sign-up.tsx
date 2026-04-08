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
import { useAuth } from '@/contexts/AuthContext';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!name.trim()) { setError('Your name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    try {
      await signUp(name.trim(), email.trim().toLowerCase(), password);
      router.replace('/(onboarding)/topics');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
            <ChevronLeftIcon size={20} color={Colors.primaryText} />
          </Pressable>

          <View style={styles.header}>
            <Text
              style={{
                fontFamily: FontFamily.heading,
                fontSize: 22,
                color: Colors.primaryText,
                letterSpacing: 4,
                marginBottom: 32,
              }}
            >
              NOETIC
            </Text>
            <Text variant="h1" style={styles.title}>
              Create your profile.
            </Text>
            <Text variant="body" color="secondary" style={styles.subtitle}>
              Your intellectual identity starts here.
            </Text>
          </View>

          <View style={styles.form}>
            {error ? (
              <View style={styles.errorBanner}>
                <Text variant="caption" color="danger">{error}</Text>
              </View>
            ) : null}

            <Input
              label="Full name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              autoCapitalize="words"
              autoComplete="name"
              returnKeyType="next"
            />

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              returnKeyType="next"
            />

            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              autoComplete="new-password"
              returnKeyType="next"
            />

            <Input
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat password"
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleSignUp}
            />

            <Button
              label="Create profile"
              onPress={handleSignUp}
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              style={styles.submitBtn}
              accessibilityLabel="Create your NOETIC profile"
            />
          </View>

          <View style={styles.footer}>
            <Text variant="body" color="secondary">Already have a profile? </Text>
            <Pressable
              onPress={() => router.replace('/(auth)/sign-in')}
              accessibilityRole="link"
              accessibilityLabel="Sign in"
            >
              <Text variant="bodyMedium" color="accent">Sign in →</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
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
  title: { marginBottom: Spacing[2] },
  subtitle: {},
  form: {},
  errorBanner: {
    backgroundColor: 'rgba(232,108,108,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(232,108,108,0.3)',
    borderRadius: 12,
    padding: Spacing[4],
    marginBottom: Spacing[4],
  },
  submitBtn: { marginTop: Spacing[4] },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing[8],
  },
});
