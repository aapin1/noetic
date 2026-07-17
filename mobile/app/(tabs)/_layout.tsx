import React, { useEffect } from 'react';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Redirect } from 'expo-router';
import {
  GitGraphIcon,
  ListIcon,
  UserIcon,
  UsersIcon,
  ZapIcon,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { SocraticProvider } from '@/contexts/SocraticContext';
import { api } from '@/lib/api';
import { prefetchQuery } from '@/hooks/useApiQuery';

function TabBarIcon({ color, icon: Icon }: { color: ColorValue; icon: React.ElementType }) {
  return <Icon size={22} color={color as string} strokeWidth={1.4} />;
}

function TabsRoot() {
  const c = useThemeColors();
  const { isAuthenticated, isLoading } = useAuth();

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
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.text,
          tabBarInactiveTintColor: c.faint,
          // Icons only — the labels crowded the bar; the title still names the
          // tab for screen readers via accessibility.
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: c.tabBar,
            borderTopWidth: 1,
            borderTopColor: c.tabBarBorder,
            height: Platform.OS === 'ios' ? 86 : 68,
            paddingTop: 14,
          },
          tabBarItemStyle: {
            paddingVertical: 4,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'atlas',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={GitGraphIcon} />,
          }}
        />
        <Tabs.Screen
          name="mind"
          options={{
            title: 'mind',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={ZapIcon} />,
          }}
        />
        <Tabs.Screen
          name="memory"
          options={{
            title: 'archive',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={ListIcon} />,
          }}
        />
        <Tabs.Screen
          name="pulse"
          options={{
            title: 'pulse',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={UsersIcon} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'you',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={UserIcon} />,
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
});
