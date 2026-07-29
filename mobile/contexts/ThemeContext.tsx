import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppThemeColors } from '@/constants/theme';
import { darkColors, lightColors } from '@/constants/theme';

const THEME_KEY = '@mneme_theme';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: AppThemeColors;
  /** What the user PICKED — may be 'system'. */
  mode: ThemeMode;
  /**
   * What that actually resolves to right now, with 'system' already followed.
   *
   * Exposed because callers need it and the alternative is guessing. The Atlas
   * used to derive it by string-comparing `colors.mapBackground` against a
   * hardcoded hex, which silently inverted the moment that colour was retuned:
   * the check went permanently false, so its toggle rendered one icon forever
   * and kept re-setting the theme it was already in. Reading a value out of the
   * palette to infer which palette you have is the bug; this is the fix.
   */
  scheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  mode: 'system',
  scheme: 'light',
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

  const scheme = useMemo<'light' | 'dark'>(() => {
    const effective = mode === 'system' ? systemScheme : mode;
    return effective === 'dark' ? 'dark' : 'light';
  }, [mode, systemScheme]);

  const colors = scheme === 'dark' ? darkColors : lightColors;

  const value = useMemo(
    () => ({ colors, mode, scheme, setMode }),
    [colors, mode, scheme, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeColors() {
  return useContext(ThemeContext).colors;
}

export function useTheme() {
  return useContext(ThemeContext);
}
