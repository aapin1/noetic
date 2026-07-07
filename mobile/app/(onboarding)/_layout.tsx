import React from 'react';
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="topics" />
      <Stack.Screen name="identity" />
      <Stack.Screen name="walkthrough" />
    </Stack>
  );
}
