import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Redirect } from 'expo-router';
import {
  GitGraphIcon,
  ListIcon,
  UserIcon,
  UsersIcon,
  ZapIcon,
} from 'lucide-react-native';
import { Radius } from '@/constants/theme';
import { RECENT_NODE_COLOR } from '@/constants/mapPalette';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useDisclosure } from '@/contexts/DisclosureContext';
import { SocraticProvider } from '@/contexts/SocraticContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { api } from '@/lib/api';
import { prefetchQuery } from '@/hooks/useApiQuery';
import { track, type TabName } from '@/lib/analytics';

/**
 * Route names are historical; the tab bar's titles are what the product calls
 * these places. Events use the product names so a dashboard reads the way the
 * app does — `archive`, not `memory`.
 */
const TAB_NAMES: Record<string, TabName> = {
  index: 'atlas',
  mind: 'mind',
  memory: 'archive',
  pulse: 'pulse',
  profile: 'you',
};

/**
 * A tab: its icon on a rounded fill that only appears when the tab is focused.
 *
 * The bar used to signal the current tab purely by tinting one of five
 * identical icons — the iOS 7 convention, and the reason it read as dated. A
 * filled shape behind the active icon is doing something a colour change can't:
 * it gives the selection a body, so the eye finds it as an object rather than
 * having to compare five glyphs for tone. The icon also thickens a notch when
 * focused, which carries the state for anyone who can't rely on the tint.
 *
 * A rounded rectangle, not a circle: circles read as buttons, and these are
 * positions in a set. The radius matches the app's `Radius.lg` cards.
 */
function TabBarIcon({
  color, icon: Icon, focused, activeBg, glow,
}: {
  color: ColorValue;
  icon: React.ElementType;
  focused: boolean;
  activeBg: string;
  glow?: boolean;
}) {
  return (
    <View style={[styles.iconSlot, focused && { backgroundColor: activeBg }]}>
      <Icon size={21} color={color as string} strokeWidth={focused ? 1.9 : 1.4} />
      {glow && !focused ? <TabPulse /> : null}
    </View>
  );
}

/**
 * The quiet glow that tells a user a tab has real content for the first time.
 * A small breathing dot in the slot's corner — absolutely positioned so it
 * never shifts icon geometry (the tutorial spotlight locates tabs by index ×
 * column width, and Maestro taps them by accessibility label; both must keep
 * working). The map's "recent" amber, because it means the same thing there:
 * something new is here.
 */
function TabPulse() {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.9);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, opacity]);

  return <Animated.View pointerEvents="none" style={[styles.tabPulse, { opacity }]} />;
}

function TabsRoot() {
  const c = useThemeColors();
  const { isAuthenticated, isLoading } = useAuth();
  const { glows, noteTabFocus } = useDisclosure();

  // Warm the caches of tabs the user hasn't visited yet, so first-visit
  // screens render instantly instead of flashing a loader. The Atlas tab
  // mounts immediately and fetches its own data (graph, intelligence, trends,
  // pulse), so only the remaining tabs' endpoints are prefetched here.
  useEffect(() => {
    if (!isAuthenticated) return;
    void prefetchQuery('archive.list', () => api.archive.list());
    void prefetchQuery('profile.wrapped', () => api.profile.wrapped());
    void prefetchQuery('profile.me:profile', () => api.profile.me().then((r) => r.profile));
  }, [isAuthenticated]);

  if (!isLoading && !isAuthenticated) {
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.root}>
      <Tabs
        // `focus` rather than `tabPress`: it fires for the tab the app opens
        // on, which tabPress misses, and it doesn't double-count a tap on the
        // tab you're already looking at.
        screenListeners={({ route }) => ({
          focus: () => {
            const tab = TAB_NAMES[route.name];
            if (tab) {
              track('tab_view', { tab });
              // Visiting a glowing tab is the acknowledgement that retires it.
              noteTabFocus(tab);
            }
          },
        })}
        screenOptions={{
          headerShown: false,
          // The bar is `deep` in both themes (see tabBar), so its icons take
          // deep ink in both — the themed tokens would be near-black on
          // near-black in light mode.
          tabBarActiveTintColor: c.deepInk,
          // `deepInkMuted`, not faint. An unselected tab is a destination the
          // user can still read, not a disabled control — too far down and the
          // four inactive icons, which are most of the bar, all mumble.
          tabBarInactiveTintColor: c.deepInkMuted,
          // Icons only — the labels crowded the bar; the title still names the
          // tab for screen readers via accessibility.
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: c.tabBar,
            // A hairline, not a 1px rule. At 1px against the old neutral border
            // this was a hard line ruled across the bottom of every screen;
            // the bar now separates by tone (`tabBar` sits off `background`)
            // and the edge only has to confirm it.
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.tabBarBorder,
            // Trimmed: this is a total height, home-indicator inset included,
            // so most of the old 86 was empty band below the icons. Keep in
            // step with TAB_H in (tabs)/index.tsx — the Atlas lays its FAB and
            // summary strip out against this exact number.
            height: Platform.OS === 'ios' ? 74 : 64,
            paddingTop: 4,
          },
          tabBarItemStyle: {
            paddingVertical: 0,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'atlas',
            // The bar hides labels (tabBarShowLabel: false), so without this
            // the tabs are invisible to VoiceOver and UI tests alike.
            tabBarAccessibilityLabel: 'atlas',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon color={color} icon={GitGraphIcon} focused={focused} activeBg={c.tabBarActive} />
            ),
          }}
        />
        <Tabs.Screen
          name="mind"
          options={{
            title: 'mind',
            tabBarAccessibilityLabel: 'mind',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon color={color} icon={ZapIcon} focused={focused} activeBg={c.tabBarActive} glow={glows.mind} />
            ),
          }}
        />
        <Tabs.Screen
          name="memory"
          options={{
            title: 'archive',
            tabBarAccessibilityLabel: 'archive',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon color={color} icon={ListIcon} focused={focused} activeBg={c.tabBarActive} glow={glows.archive} />
            ),
          }}
        />
        <Tabs.Screen
          name="pulse"
          options={{
            title: 'pulse',
            tabBarAccessibilityLabel: 'pulse',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon color={color} icon={UsersIcon} focused={focused} activeBg={c.tabBarActive} glow={glows.pulse} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'you',
            tabBarAccessibilityLabel: 'you',
            tabBarIcon: ({ color, focused }) => (
              <TabBarIcon color={color} icon={UserIcon} focused={focused} activeBg={c.tabBarActive} glow={glows.you} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <SocraticProvider>
      <TabsRoot />
    </SocraticProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  iconSlot: {
    width: 46,
    height: 32,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPulse: {
    position: 'absolute',
    top: 3,
    right: 7,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: RECENT_NODE_COLOR,
  },
});
