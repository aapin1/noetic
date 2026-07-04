import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppThemeColors } from '@/constants/theme';
import { darkColors, lightColors } from '@/constants/theme';

const THEME_KEY = '@mneme_theme';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: AppThemeColors;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  mode: 'system',
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    void AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setModeState(saved);
      }
    });
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    void AsyncStorage.setItem(THEME_KEY, newMode);
  }, []);

  const colors = useMemo(() => {
    const effective = mode === 'system' ? systemScheme : mode;
    return effective === 'dark' ? darkColors : lightColors;
  }, [mode, systemScheme]);

  return (
    <ThemeContext.Provider value={{ colors, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeColors() {
  return useContext(ThemeContext).colors;
}

export function useTheme() {
  return useContext(ThemeContext);
}
