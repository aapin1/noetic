import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Push: permission, token registration, and what happens when a notification is
 * tapped.
 *
 * Mounted under AuthProvider because every part of it depends on there being a
 * signed-in account — a token is worthless without a user to hang it on, and a
 * deep link into Mind is worthless if we're about to bounce to sign-in.
 */

// How a push behaves while the app is already open. Mneme's notifications are
// observations about your own thinking, not alerts — they're worth showing, but
// never worth a badge count. Badges are the "you have 3 unread" pattern this
// feature exists to avoid.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Turn a server-issued deepLink into a route this app actually has.
 *
 * The social notification types predate the mobile app's route table and point
 * at `/content/:id` and `/profile/:id`, neither of which exists here — tapping
 * one would land on +not-found. Rather than leave that, unknown links resolve to
 * the nearest screen that makes sense for the notification.
 */
export function resolveDeepLink(deepLink: string | undefined | null): string {
  if (!deepLink || typeof deepLink !== 'string') return '/(tabs)';

  // Routes the app really has, passed through untouched.
  if (deepLink === '/today') return '/today';
  if (/^\/insight\/[^/]+$/.test(deepLink)) return deepLink;
  if (/^\/archive\/[^/]+$/.test(deepLink)) return deepLink;
  if (/^\/position\/[^/]+$/.test(deepLink)) return deepLink;
  if (/^\/socratic\/[^/]+$/.test(deepLink)) return deepLink;
  if (deepLink === '/(tabs)/mind' || deepLink === '/mind') return '/(tabs)/mind';
  if (deepLink === '/(tabs)/pulse' || deepLink === '/pulse') return '/(tabs)/pulse';
  if (deepLink === '/(tabs)/memory' || deepLink === '/memory') return '/(tabs)/memory';

  // Legacy social links: a review, a comment, someone following you. There is no
  // per-content or per-person screen on mobile, but Pulse is where other
  // people's activity lives, so that's the honest destination.
  if (deepLink.startsWith('/content/') || deepLink.startsWith('/profile/')) return '/(tabs)/pulse';

  return '/(tabs)';
}

interface NotificationContextValue {
  /** Whether the OS has granted permission this launch. */
  granted: boolean;
  /**
   * Show the system prompt and, if granted, register this device.
   * Returns whether permission ended up granted. Never throws.
   */
  requestPermission: () => Promise<boolean>;
  /**
   * Re-read the OS permission and register if it is now granted, without ever
   * prompting. For the trip out to iOS Settings and back: granting there only
   * backgrounds the app, and launch-time registration has already run for this
   * session, so without this the user would hold permission but own no token
   * until their next cold start. Never throws.
   */
  refreshPermission: () => Promise<boolean>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function getProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/**
 * Fetch the Expo push token and hand it to the backend.
 *
 * Best-effort by design: this runs on app launch and after a capture, and
 * neither of those should ever surface an error because a push token couldn't
 * be minted (simulator, no network, revoked permission).
 */
async function registerToken(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // Android requires a channel before anything will display.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#252119',
      });
    }

    const projectId = getProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) return false;

    await api.devices.register(token, Platform.OS === 'android' ? 'ANDROID' : 'IOS');
    return true;
  } catch {
    // Simulators have no APNs entitlement and always land here. Nothing to do:
    // the user simply doesn't receive pushes on that device.
    return false;
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [granted, setGranted] = useState(false);

  // A notification tapped from a cold start arrives before the router is ready
  // and possibly before auth resolves. Hold it, then navigate once we can.
  const pendingLink = useRef<string | null>(null);
  const registeredRef = useRef(false);
  /** Notification ids already routed, so one tap never navigates twice. */
  const handledTaps = useRef<Set<string>>(new Set());

  const navigate = useCallback((deepLink: string | undefined | null) => {
    const target = resolveDeepLink(deepLink);
    if (!isAuthenticated) {
      pendingLink.current = target;
      return;
    }
    // expo-router's typed routes can't know about server-issued strings.
    router.push(target as never);
  }, [isAuthenticated]);

  // Re-register on every authenticated launch, but only when permission is
  // already granted — asking here is exactly the launch-time prompt we refuse
  // to show. Tokens rotate (OS reinstall, restore from backup), so a silent
  // refresh each launch is what keeps a long-lived account reachable.
  useEffect(() => {
    if (!isAuthenticated || registeredRef.current) return;
    registeredRef.current = true;

    void (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;
        setGranted(true);
        await registerToken();
      } catch {
        // Nothing here is worth interrupting a launch for.
      }
    })();
  }, [isAuthenticated]);

  // Reset so a second account on the same device registers its own token.
  useEffect(() => {
    if (!isAuthenticated) registeredRef.current = false;
  }, [isAuthenticated]);

  // Flush a link captured before we were ready.
  useEffect(() => {
    if (!isAuthenticated || !pendingLink.current) return;
    const target = pendingLink.current;
    pendingLink.current = null;
    // One tick, so the navigator has mounted its routes.
    const timer = setTimeout(() => router.push(target as never), 0);
    return () => clearTimeout(timer);
  }, [isAuthenticated]);

  // Taps, whether the app was running or launched by the notification.
  useEffect(() => {
    // A tap that launched the app is reported BOTH by getLastNotificationResponse
    // and (depending on timing) to a listener registered right after. Acting on
    // both pushes the same screen twice — and with the back gesture disabled
    // app-wide, that costs the user two taps to undo. Handle each tap once.
    const handle = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledTaps.current.has(id)) return;
      handledTaps.current.add(id);
      const data = response.notification.request.content.data as { deepLink?: string } | undefined;
      navigate(data?.deepLink);
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handle);

    // Cold start: the tap that launched the app already happened, so it may
    // never reach the listener above.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => { if (response) handle(response); })
      .catch(() => {});

    return () => sub.remove();
  }, [navigate]);

  const requestPermission = useCallback(async () => {
    try {
      const existing = await Notifications.getPermissionsAsync();
      const status = existing.status === 'granted'
        ? existing.status
        : (await Notifications.requestPermissionsAsync()).status;

      if (status !== 'granted') {
        setGranted(false);
        return false;
      }

      setGranted(true);
      await registerToken();
      return true;
    } catch {
      return false;
    }
  }, []);

  const refreshPermission = useCallback(async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const isGranted = status === 'granted';
      setGranted(isGranted);
      // Deliberately not guarded by registeredRef: that guard exists to keep one
      // launch from registering twice, and this is a different event — the user
      // just changed the answer. `register` upserts, so a redundant call is free.
      if (isGranted) await registerToken();
      return isGranted;
    } catch {
      return false;
    }
  }, []);

  return (
    <NotificationContext.Provider value={{ granted, requestPermission, refreshPermission }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
