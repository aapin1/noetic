import React from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Brain, GitGraphIcon, LineChartIcon, UserIcon } from 'lucide-react-native';
import { FontFamily, FontSize } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';

function TabBarIcon({ color, icon: Icon }: { color: string; icon: React.ElementType }) {
  return <Icon size={20} color={color} strokeWidth={1.35} />;
}

export default function TabsLayout() {
  const c = useThemeColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.faint,
        tabBarLabelStyle: {
          fontFamily: FontFamily.mono,
          fontSize: FontSize.xs,
          letterSpacing: 1.1,
          marginBottom: Platform.OS === 'ios' ? 0 : 4,
          textTransform: 'uppercase',
        },
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderTopWidth: 1,
          borderTopColor: c.border,
          height: Platform.OS === 'ios' ? 86 : 68,
          paddingTop: 10,
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Capture',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={Brain} />,
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: 'Memory',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={GitGraphIcon} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: 'Drift',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={LineChartIcon} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'You',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={UserIcon} />,
        }}
      />
    </Tabs>
  );
}
