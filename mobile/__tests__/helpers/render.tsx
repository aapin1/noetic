/**
 * Renders a screen inside the providers it needs on device.
 *
 * Only the safe-area metrics are faked (there's no window to measure); the
 * theme provider is the real one, so colour and scheme logic runs as shipped.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/contexts/ThemeContext';

/** iPhone-ish insets — enough for layout code that branches on a notch. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Async because RNTL v14's `render` is: React 19 renders through a concurrent
 * root, so the tree (and the global `screen`) only exists after it resolves.
 * Every call site must await it.
 */
export function renderScreen(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider>{children}</ThemeProvider>
      </SafeAreaProvider>
    ),
  });
}
