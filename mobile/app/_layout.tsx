import React, { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ShareIntentProvider } from 'expo-share-intent';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { TutorialProvider } from '@/contexts/TutorialContext';
import { TutorialOverlay } from '@/components/ui/TutorialOverlay';
import { KeyboardDismissButton } from '@/components/ui/KeyboardDismissButton';
import { hydrateQueryCache } from '@/hooks/useApiQuery';
import { warmBackend } from '@/lib/api';

SplashScreen.preventAutoHideAsync();

function ThemedStatusBar() {
  const scheme = useColorScheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  // Hold the splash until the previous session's cache is loaded, so the
  // first screen renders populated instead of blank. Meanwhile, ping the
  // backend so a cold Render instance starts booting before the user's first
  // real request.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    warmBackend();
    void hydrateQueryCache().finally(() => {
      setHydrated(true);
      void SplashScreen.hideAsync();
    });
  }, []);

  if (!hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider>
        <ThemeProvider>
          <AuthProvider>
            <TutorialProvider>
              <ThemedStatusBar />
              <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="insight/[id]" options={{ presentation: 'card' }} />
                <Stack.Screen name="archive/[topicId]" options={{ presentation: 'card' }} />
                <Stack.Screen name="profile/edit" options={{ presentation: 'modal' }} />
                <Stack.Screen name="settings" options={{ presentation: 'card' }} />
                <Stack.Screen name="plus" options={{ presentation: 'modal' }} />
                <Stack.Screen name="shareintent" options={{ presentation: 'modal' }} />
                <Stack.Screen name="+not-found" />
              </Stack>
              <TutorialOverlay />
              {/* After the overlay so it stays tappable mid-walkthrough. */}
              <KeyboardDismissButton />
            </TutorialProvider>
          </AuthProvider>
        </ThemeProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}
