import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Colors, FontFamily, Radius } from '@/constants/theme';
import { Text } from '@/components/ui/Text';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  uri?: string | null;
  displayName?: string;
  size?: Size;
}

const sizeMap: Record<Size, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

const fontSizeMap: Record<Size, number> = {
  xs: 9,
  sm: 12,
  md: 15,
  lg: 20,
  xl: 28,
};

function getInitials(displayName?: string): string {
  if (!displayName) return '?';
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getColorForName(name?: string): string {
  const palette = [
    '#C8A55B',
    '#8C7BFF',
    '#78D39D',
    '#E8A06C',
    '#6CB5E8',
  ];
  if (!name) return palette[0];
  const idx = name.charCodeAt(0) % palette.length;
  return palette[idx];
}

export function Avatar({ uri, displayName, size = 'md' }: Props) {
  const dimension = sizeMap[size];
  const bg = getColorForName(displayName);
  const initials = getInitials(displayName);

  return (
    <View
      style={[
        styles.container,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          backgroundColor: bg,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={[
            styles.image,
            { width: dimension, height: dimension, borderRadius: dimension / 2 },
          ]}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <Text
          style={[
            styles.initials,
            { fontSize: fontSizeMap[size] },
          ]}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Colors.cardBorder,
  },
  image: {
    position: 'absolute',
  },
  initials: {
    fontFamily: FontFamily.bodySemiBold,
    color: Colors.white,
    letterSpacing: 0.5,
  },
});
