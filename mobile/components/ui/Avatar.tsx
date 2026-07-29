import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { FontFamily } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  uri?: string | null;
  displayName?: string | null;
  size?: Size;
  /**
   * Set when the avatar sits on a `deep` surface. The fallback initials
   * normally take `c.text`, which is a near-black in light mode and therefore
   * invisible on a dark panel — the profile hero is exactly that case, and it
   * only shows for people who haven't set a photo, which is the wrong bug to
   * ship blind.
   */
  onDeep?: boolean;
}

const sizeMap: Record<Size, number> = {
  xs: 22,
  sm: 30,
  md: 38,
  lg: 56,
  xl: 80,
};

const fontSizeMap: Record<Size, number> = {
  xs: 9,
  sm: 11,
  md: 13,
  lg: 18,
  xl: 26,
};

function getInitials(displayName?: string | null): string {
  if (!displayName) return '·';
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ uri, displayName, size = 'md', onDeep = false }: Props) {
  const c = useThemeColors();
  const dimension = sizeMap[size];
  const initials = getInitials(displayName);

  return (
    <View
      style={[
        styles.container,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          borderColor: onDeep ? c.deepBorder : c.border,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: dimension, height: dimension, borderRadius: dimension / 2 }}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <Text
          style={[
            styles.initials,
            {
              fontSize: fontSizeMap[size],
              lineHeight: dimension,
              color: onDeep ? c.deepInk : c.text,
              fontFamily: FontFamily.mono,
              includeFontPadding: false,
            },
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
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  initials: {
    letterSpacing: 1.4,
  },
});
