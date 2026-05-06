import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { AppThemeColors } from '@/constants/theme';
import { darkColors, lightColors } from '@/constants/theme';

const ThemeContext = createContext<AppThemeColors>(lightColors);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const colors = useMemo(() => (scheme === 'dark' ? darkColors : lightColors), [scheme]);
  return <ThemeContext.Provider value={colors}>{children}</ThemeContext.Provider>;
}

export function useThemeColors() {
  return useContext(ThemeContext);
}
