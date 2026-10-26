import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { actions } from '@/data/store';
import { usePalette } from '@/theme';
import { ItemSheetHost } from '@/features/items/ItemSheet';
import { MoveFlowHost } from '@/features/move/MoveFlowHost';
// Defines the background location task; must load at startup, before any run.
import '@/features/run/recording';
import { RecoveryPrompt } from '@/features/run/RecoveryPrompt';
import { Snackbar } from '@/ui/Snackbar';

export default function RootLayout() {
  const p = usePalette();

  // "Today" changes at midnight and while the app sits in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') actions.refreshToday();
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: p.bg }}>
      <StatusBar style={p.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg }, animation: 'fade', animationDuration: 200 }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="setup" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="diagnostics" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="run" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="summary/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="replay/[id]" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      <ItemSheetHost />
      <MoveFlowHost />
      <RecoveryPrompt />
      <Snackbar />
    </GestureHandlerRootView>
  );
}
