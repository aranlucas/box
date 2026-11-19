import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { setHouseholdHouse, startHousehold } from '@/lib/household';
import { queryClient } from '@/lib/query';
import { useSession } from '@/lib/session';
import { colors } from '@/ui/theme';
import { TopBar } from '@/ui/top-bar';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    startHousehold(); // share this device's printer with the house / find a printer in it
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <HouseholdSync />
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

/** Keep printer sharing pointed at the house this device is looking at. */
function HouseholdSync() {
  const { house } = useSession();
  const houseId = house?.id ?? null;
  useEffect(() => setHouseholdHouse(houseId), [houseId]);
  return null;
}
