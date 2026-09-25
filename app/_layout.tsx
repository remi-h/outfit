import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { useColorScheme } from '@/components/useColorScheme';
import { AppStateProvider, useAppState } from '@/src/store';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/item/[id]` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Keep the splash up while we read AsyncStorage, so the closet never flashes
// its empty state before the saved items land.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden — nothing to do */
});

export default function RootLayout() {
  return (
    <AppStateProvider>
      <RootNavigator />
    </AppStateProvider>
  );
}

function RootNavigator() {
  const colorScheme = useColorScheme();
  const { hydrated } = useAppState();

  useEffect(() => {
    if (hydrated) {
      SplashScreen.hideAsync().catch(() => {
        /* already hidden — nothing to do */
      });
    }
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="item/[id]" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}
