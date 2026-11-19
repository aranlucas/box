import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { queryClient } from '@/lib/query';
import { colors } from '@/ui/theme';
import { TopBar } from '@/ui/top-bar';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          header: (props) => <TopBar {...props} />,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="index" options={{ title: 'Boxes', headerShown: false }} />
        <Stack.Screen name="new" options={{ title: 'New box' }} />
        <Stack.Screen name="b/[id]" options={{ title: 'Box' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="invite/[token]" options={{ title: 'Invite' }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
      </Stack>
    </QueryClientProvider>
  );
}
