import React, { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ShareIntentProvider } from 'expo-share-intent';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { TutorialProvider } from '@/contexts/TutorialContext';
import { TutorialOverlay } from '@/components/ui/TutorialOverlay';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { KeyboardDismissButton } from '@/components/ui/KeyboardDismissButton';
import { hydrateQueryCache } from '@/hooks/useApiQuery';
import { warmBackend } from '@/lib/api';
import {
  initAnalytics,
  initCrashReporting,
  trackSessionStart,
  wrapRoot,
} from '@/lib/analytics';
import { noteSessionForReview } from '@/lib/review';

SplashScreen.preventAutoHideAsync();

// At module scope rather than in an effect: a crash while the providers below
// are mounting is exactly the crash worth catching, and Sentry has to already
// be listening when it happens.
initCrashReporting();

function ThemedStatusBar() {
  const scheme = useColorScheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

function RootLayout() {
  // Hold the splash until the previous session's cache is loaded, so the
  // first screen renders populated instead of blank. Meanwhile, ping the
  // backend so a cold Render instance starts booting before the user's first
  // real request.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    warmBackend();
    // After the warm-up call, before the await: analytics must never be a
    // reason the splash stays up a moment longer.
    initAnalytics();
    trackSessionStart();
    noteSessionForReview();
    void hydrateQueryCache().finally(() => {
      setHydrated(true);
      void SplashScreen.hideAsync();
    });
  }, []);

  if (!hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Above the providers on purpose: a throw inside one of them is
          exactly the case that would otherwise white-screen the app. */}
      <ErrorBoundary>
      <ShareIntentProvider>
        <ThemeProvider>
          <AuthProvider>
            {/* Under AuthProvider: it registers a device token for the signed-in
                user and routes notification taps, so it needs to know both who
                is signed in and whether anyone is. */}
            <NotificationProvider>
            <TutorialProvider>
              <ThemedStatusBar />
              {/* gestureEnabled: false — navigation is fully button-driven
                  (every card screen has an explicit back control). The iOS
                  edge-swipe pop gesture fought every horizontal pan in the app:
                  a leftward drag starting near the screen edge on the map (or
                  any horizontally-scrolling surface) popped the route like a
                  browser back-swipe. Modals re-enable it so swipe-down-to-
                  dismiss (a vertical gesture, no conflict) keeps working. */}
              <Stack screenOptions={{ headerShown: false, animation: 'fade', gestureEnabled: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="insight/[id]" options={{ presentation: 'card' }} />
                <Stack.Screen name="archive/[topicId]" options={{ presentation: 'card' }} />
                <Stack.Screen name="profile/edit" options={{ presentation: 'modal', gestureEnabled: true }} />
                <Stack.Screen name="settings" options={{ presentation: 'card' }} />
                <Stack.Screen name="blocked" options={{ presentation: 'card' }} />
                <Stack.Screen name="notification-settings" options={{ presentation: 'card' }} />
                <Stack.Screen name="terrain" options={{ presentation: 'card' }} />
                <Stack.Screen name="plus" options={{ presentation: 'modal', gestureEnabled: true }} />
                <Stack.Screen name="share-recap" options={{ presentation: 'modal', gestureEnabled: true }} />
                <Stack.Screen name="shareintent" options={{ presentation: 'modal', gestureEnabled: true }} />
                <Stack.Screen name="+not-found" />
              </Stack>
              <TutorialOverlay />
              {/* After the overlay so it stays tappable mid-walkthrough. */}
              <KeyboardDismissButton />
            </TutorialProvider>
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </ShareIntentProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

// Sentry's wrapper adds startup and navigation instrumentation. It degrades to
// a pass-through when the SDK or DSN is absent.
export default wrapRoot(RootLayout);
