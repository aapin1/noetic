import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Link, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

export default function NotFoundScreen() {
  const c = useThemeColors();
  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerShown: true }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['bottom']}>
        <View style={styles.container}>
          <Text variant="h1" style={[styles.code, { color: c.muted }]}>
            404
          </Text>
          <Text variant="h3" style={styles.title}>
            Nothing here.
          </Text>
          <Text variant="body" color="secondary" style={styles.body}>
            That route is gone or never existed.
          </Text>
          <Link href="/(tabs)" style={styles.link}>
            <Text variant="bodyMedium" color="accent">
              Back to capture →
            </Text>
          </Link>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[8],
  },
  code: {
    marginBottom: Spacing[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing[3],
  },
  body: {
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: Spacing[8],
  },
  link: {
    marginTop: Spacing[4],
  },
});
