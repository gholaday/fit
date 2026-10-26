/**
 * Settings > Health Connect (spec §11): status, the permission rationale and request,
 * import preferences and "Re-sync last 30 days". The rationale is shown before Android's
 * permission sheet so the reads are explained in our words first.
 */
import type { HealthConnectPrefs } from '@fit/core';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, ScrollView, Switch, View } from 'react-native';
import { openHealthConnectSettings } from 'react-native-health-connect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions, showSnack, useSettings } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Group, IconButton, Row, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { syncedLabel, useHealth } from './state';
import { type HealthStatus, READ_PERMISSIONS, healthStatus, requestHealthPermissions, resyncHealth, syncHealth } from './sync';

const PLAY_STORE = 'market://details?id=com.google.android.apps.healthdata';

const READS: readonly { label: string; why: string }[] = [
  { label: 'Exercise sessions', why: 'Watch workouts, to mark plan items done' },
  { label: 'Heart rate', why: 'Fills gaps in heart rate on your runs' },
  { label: 'Steps', why: 'Your daily step goal on Today' },
  { label: 'Resting heart rate', why: 'Shown on Today' },
  { label: 'Active calories', why: 'Stored with workouts and days' },
  { label: 'Distance', why: 'How far your watch workouts went' },
];

export function HealthConnectScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const prefs = useSettings().healthConnect;
  const lastSyncedAt = useHealth((h) => h.lastSyncedAt);
  const [status, setStatus] = useState<HealthStatus>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => void healthStatus().then(setStatus), []);
  // Permissions can change in the Health Connect app; re-read when we come back.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const set = (patch: Partial<HealthConnectPrefs>) => {
    haptic.tick();
    actions.updateSettings({ healthConnect: { ...prefs, ...patch } });
  };

  const run = async (work: () => Promise<{ ok: boolean }>, done: string) => {
    setBusy(true);
    const r = await work();
    setBusy(false);
    refresh();
    showSnack({ message: r.ok ? done : 'Sync failed, try again later' });
  };

  const connect = async () => {
    haptic.commit();
    const granted = await requestHealthPermissions();
    refresh();
    if (granted > 0) await run(syncHealth, 'Synced with Health Connect');
  };

  const connected = status?.availability === 'available' && status.granted > 0;
  const statusText =
    status === undefined
      ? 'Checking'
      : status.availability === 'missing'
        ? 'Not installed'
        : status.availability === 'update'
          ? 'Needs an update'
          : status.granted === 0
            ? 'Installed, not connected'
            : status.granted < READ_PERMISSIONS.length
              ? `Connected, ${status.granted} of ${READ_PERMISSIONS.length} data types`
              : 'Connected';

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <T v="heading" accessibilityRole="header">
            Health Connect
          </T>
        </View>

        <Group>
          <Row label="Status" sub={lastSyncedAt && connected ? `Last synced ${syncedLabel(lastSyncedAt)}` : undefined} last>
            {status === undefined || busy ? (
              <ActivityIndicator size="small" color={p.textTertiary} />
            ) : (
              <T v="label" color={connected ? p.success : p.textSecondary}>
                {statusText}
              </T>
            )}
          </Row>
        </Group>

        {status && status.availability !== 'available' && (
          <View style={{ gap: 12 }}>
            <T v="body" tone="secondary">
              {status.availability === 'missing' ? 'Health Connect is not on this phone. Install it from the Play Store, then come back here.' : 'Health Connect needs an update before Fit can read from it.'}
            </T>
            <Button
              label={status.availability === 'missing' ? 'Install Health Connect' : 'Update Health Connect'}
              size="md"
              onPress={() => {
                haptic.tap();
                void Linking.openURL(PLAY_STORE);
              }}
            />
          </View>
        )}

        {status?.availability === 'available' && !connected && (
          <View style={{ gap: 12 }}>
            <T v="body" tone="secondary">
              Fit reads what your Garmin watch syncs to Health Connect. It never writes to Health Connect, and the data stays on this phone.
            </T>
            <Group>
              {READS.map((r, i) => (
                <Row key={r.label} label={r.label} sub={r.why} last={i === READS.length - 1} />
              ))}
            </Group>
            <Button label="Connect Health Connect" onPress={() => void connect()} />
          </View>
        )}

        {connected && (
          <>
            <View style={{ gap: 8 }}>
              <T v="labelStrong" tone="secondary">
                Import
              </T>
              <Group>
                <Toggle label="Watch workouts" sub="Ask where each new workout fits your plan" value={prefs.importWorkouts} onChange={(importWorkouts) => set({ importWorkouts })} />
                <Toggle label="Link matches without asking" sub="When one plan item clearly matches" value={prefs.autoMatch} onChange={(autoMatch) => set({ autoMatch })} />
                <Toggle label="Heart rate on your runs" sub="Fill gaps when no sensor was connected" value={prefs.addHr} onChange={(addHr) => set({ addHr })} />
                <Toggle label="All apps" sub="Import from every app, not only Garmin Connect" value={prefs.allSources} onChange={(allSources) => set({ allSources })} last />
              </Group>
            </View>
            <View style={{ gap: 8 }}>
              {status && status.granted < READ_PERMISSIONS.length && <Button label="Allow the remaining data types" kind="outline" size="md" onPress={() => void connect()} />}
              <Button label="Sync now" size="md" disabled={busy} onPress={() => void run(syncHealth, 'Synced with Health Connect')} />
              <Button
                label="Re-sync last 30 days"
                kind="quiet"
                size="md"
                disabled={busy}
                onPress={() => {
                  haptic.tap();
                  void run(resyncHealth, 'Re-synced the last 30 days');
                }}
              />
              <Button
                label="Manage permissions"
                kind="quiet"
                size="md"
                onPress={() => {
                  haptic.tap();
                  openHealthConnectSettings();
                }}
              />
            </View>
          </>
        )}
      </ScrollView>
      <StatusShade />
    </View>
  );
}

function Toggle({ label, sub, value, onChange, last }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  const p = usePalette();
  return (
    <Row label={label} sub={sub} last={last}>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: p.primary, false: p.border }} thumbColor={p.surface} accessibilityLabel={label} />
    </Row>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, gap: 20 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
}));
