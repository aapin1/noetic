import React from 'react';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import {
  HomeIcon,
  BellIcon,
  SearchIcon,
  UserIcon,
} from 'lucide-react-native';
import { Colors, FontFamily, FontSize } from '@/constants/theme';

function TabBarIcon({ color, icon: Icon }: { color: string; icon: React.ElementType }) {
  return <Icon size={22} color={color} strokeWidth={1.8} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primaryText,
        tabBarInactiveTintColor: Colors.mutedText,
        tabBarLabelStyle: {
          fontFamily: FontFamily.mono,
          fontSize: FontSize.xs,
          marginBottom: Platform.OS === 'ios' ? 0 : 4,
          letterSpacing: 0.5,
        },
        tabBarStyle: {
          backgroundColor: Colors.background,
          borderTopWidth: 1,
          borderTopColor: Colors.cardBorder,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 8,
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={HomeIcon} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={SearchIcon} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={BellIcon} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={UserIcon} />,
        }}
      />
    </Tabs>
  );
}
