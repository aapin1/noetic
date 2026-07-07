import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Redirect } from 'expo-router';
import {
  GitGraphIcon,
  LineChartIcon,
  ListIcon,
  MessageCircleIcon,
  UserIcon,
  UsersIcon,
  ZapIcon,
} from 'lucide-react-native';
import { FontFamily, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/contexts/ThemeContext';
import { SocraticProvider, useSocratic } from '@/contexts/SocraticContext';
import { useTutorialTarget } from '@/contexts/TutorialContext';
import { TUTORIAL_TARGET } from '@/constants/tutorialSteps';
import { api } from '@/lib/api';

function TabBarIcon({ color, icon: Icon }: { color: string; icon: React.ElementType }) {
  return <Icon size={18} color={color} strokeWidth={1.2} />;
}

function SocraticFab() {
  const c = useThemeColors();
  const router = useRouter();
  const { topicId } = useSocratic();
  const [loading, setLoading] = useState(false);
  const companionTarget = useTutorialTarget(TUTORIAL_TARGET.companionFab);

  const handlePress = async () => {
    if (loading) return;
    companionTarget.press();
    let tid = topicId;
    if (!tid) {
      setLoading(true);
      try {
        const trends = await api.memory.trends();
        tid = trends.themes[0]?.topicId ?? null;
      } catch {
        tid = null;
      } finally {
        setLoading(false);
      }
    }
    if (!tid) {
      router.push('/companion' as never);
      return;
    }
    router.push({ pathname: '/socratic/[topicId]' as never, params: { topicId: tid } });
  };

  return (
    <Pressable
      ref={companionTarget.isActive ? companionTarget.ref : undefined}
      onLayout={companionTarget.isActive ? companionTarget.onLayout : undefined}
      onPress={() => void handlePress()}
      disabled={loading}
      style={[styles.fab, { borderColor: c.border, backgroundColor: c.elevated }]}
      accessibilityLabel="Open Socratic dialogue"
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator size="small" color={c.muted} />
      ) : (
        <MessageCircleIcon size={20} color={c.muted} strokeWidth={1.4} />
      )}
    </Pressable>
  );
}

function TabsWithFab() {
  const c = useThemeColors();
  const { isAuthenticated, isLoading } = useAuth();

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
          tabBarLabelStyle: {
            fontFamily: FontFamily.mono,
            fontSize: 9,
            letterSpacing: 2,
            marginBottom: Platform.OS === 'ios' ? 0 : 4,
            textTransform: 'uppercase',
          },
          tabBarStyle: {
            backgroundColor: c.tabBar,
            borderTopWidth: 1,
            borderTopColor: c.tabBarBorder,
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
            title: 'atlas',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={GitGraphIcon} />,
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
          name="trends"
          options={{
            title: 'drift',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={LineChartIcon} />,
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
          name="profile"
          options={{
            title: 'you',
            tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={UserIcon} />,
          }}
        />
      </Tabs>
      <SocraticFab />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <SocraticProvider>
      <TabsWithFab />
    </SocraticProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fab: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 104 : 86,
    right: Spacing[5],
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
});
