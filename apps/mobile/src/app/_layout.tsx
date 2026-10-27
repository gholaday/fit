import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { repo } from '@/data';
import { actions } from '@/data/store';
import { usePalette } from '@/theme';
import { ActivityModalHost } from '@/features/health/ActivityModal';
import { reloadHealth } from '@/features/health/state';
import { syncHealth } from '@/features/health/sync';
import { ItemSheetHost } from '@/features/items/ItemSheet';
import { MoveFlowHost } from '@/features/move/MoveFlowHost';
import { RebuildPrompt } from '@/features/plan/RebuildPrompt';
// Defines the background location task; must load at startup, before any run.
import '@/features/run/recording';
import { RecoveryPrompt } from '@/features/run/RecoveryPrompt';
import { seedCatalogIfNeeded } from '@/features/library/catalog';
import { startReminderSync } from '@/features/library/reminders';
import { Snackbar } from '@/ui/Snackbar';

export default function RootLayout() {
  const p = usePalette();

  // The exercise catalog seeds after first paint, only when the bundled version is new.
  useEffect(() => {
    let stop: (() => void) | undefined;
    const t = setTimeout(() => {
      void seedCatalogIfNeeded();
      actions.adaptPlan(false);
      reloadHealth();
      void syncHealth();
      stop = startReminderSync();
    }, 300);
    // Records build once, after the first paint settles, so Summary and Stats read them free.
    const warm = requestIdleCallback(() => {
      const t0 = Date.now();
      repo.warmRecords();
      if (__DEV__) console.log(`[records] warm ${Date.now() - t0} ms`);
    });
    return () => {
      clearTimeout(t);
      cancelIdleCallback(warm);
      stop?.();
    };
  }, []);

  // "Today" changes at midnight and while the app sits in the background.
  useEffect(() => {
    // Only a real return from the background: Android also reports 'active' once on a cold
    // start, and the first-paint effect above already adapts and syncs then.
    let away = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') away = true;
      if (state !== 'active' || !away) return;
      away = false;
      actions.refreshToday();
      actions.adaptPlan(false);
      void syncHealth();
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
        <Stack.Screen name="hr-sensor" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="health-connect" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="pace" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="run-plan" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="activity/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="lift/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="run" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="summary/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="replay/[id]" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="routine/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="routine/edit" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="workout/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="workout/edit" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="exercises" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="exercise/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="exercise/new" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="strength/[id]" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="stretch/[id]" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
      </Stack>
      <ItemSheetHost />
      <MoveFlowHost />
      <RecoveryPrompt />
      <RebuildPrompt />
      <ActivityModalHost />
      <Snackbar />
    </GestureHandlerRootView>
  );
}
