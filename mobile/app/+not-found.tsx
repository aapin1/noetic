import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Link, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerShown: true }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.container}>
          <Text variant="h1" style={styles.code}>404</Text>
          <Text variant="h3" style={styles.title}>This page doesn't exist.</Text>
          <Text variant="body" color="secondary" style={styles.body}>
            The profile, content, or page you're looking for may have moved or been removed.
          </Text>
          <Link href="/(tabs)" style={styles.link}>
            <Text variant="bodyMedium" color="accent">Return to feed →</Text>
          </Link>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[8],
  },
  code: {
    color: Colors.accentGold,
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
