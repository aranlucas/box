import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Stack, type NativeStackHeaderProps, type NativeStackNavigationOptions } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useSharePrinter } from '@/lib/household';
import { queries } from '@/lib/queries';
import { queryClient } from '@/lib/query';
import { useSession } from '@/lib/session';
import { colors } from '@/ui/theme';
import { TopBar } from '@/ui/top-bar';

void SplashScreen.preventAutoHideAsync().catch(() => {});

const screenOptions: NativeStackNavigationOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  headerTintColor: colors.kraftDark,
  headerTitleStyle: { color: colors.ink, fontWeight: '700' },
  headerTitleAlign: 'center',
  contentStyle: { backgroundColor: colors.bg },
  // The native header can't be confined to the page column on wide web screens; TopBar can.
  ...(Platform.OS === 'web' && {
    header: (props: NativeStackHeaderProps) => <TopBar {...props} />,
  }),
};

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <HouseholdSync />
      <StatusBar style="dark" />
      <Stack screenOptions={screenOptions}>
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

/**
 * Share this device's printer with the house it is looking at, and reconnect the last-used printer
 * once at app start (whatever screen opens first) so a shared printer keeps serving the house.
 */
function HouseholdSync() {
  const session = useSession();
  const houseId = session.status === 'signed-in' ? session.house?.id : undefined;
  // Only once this device is in a house: a signed-out device has nobody to share the printer with.
  useQuery({ ...queries.printerReconnect(), enabled: houseId !== undefined });
  useSharePrinter(houseId);
  return null;
}
