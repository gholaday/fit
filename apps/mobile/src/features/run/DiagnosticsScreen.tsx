/**
 * Permissions and diagnostics (spec §5): everything that decides whether a run records with
 * the screen off, plus a live GPS check. While this screen is open (and no run is going) it
 * watches GPS itself, so "Last fix" shows real freshness and accuracy.
 */
import * as Device from 'expo-device';
import { Location, LocationProfile, LocationUpdatesHandle, type PositionWatchHandle } from 'expo-location/next';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Group, IconButton, Row, T } from '@/ui/primitives';
import { useRun } from './engine';
import { isSamsung, openAppSettings, type RecordingAccess, readAccess, requestBackground, requestBatteryExemption, requestLocation, requestNotifications } from './permissions';
import { LOCATION_TASK } from './recording';

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
}

export function DiagnosticsScreen() {
  const p = usePalette();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [access, setAccess] = useState<RecordingAccess>();
  const [fix, setFix] = useState<{ t: number; accuracy: number | null; mocked: boolean }>();
  const [now, setNow] = useState(() => Date.now());
  const [delivery, setDelivery] = useState<boolean>();
  const running = useRun((r) => r.phase === 'active' || r.phase === 'paused');

  const refresh = () => {
    void readAccess().then(setAccess);
    void new LocationUpdatesHandle(LOCATION_TASK).hasStarted().then(setDelivery);
  };
  useEffect(refresh, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, []);

  // A live watch for the "Last fix" row. Skipped during a run, which owns the GPS.
  const granted = access?.location === 'granted' || access?.location === 'approximate';
  useEffect(() => {
    if (!granted || running) return;
    let watch: PositionWatchHandle | undefined = Location.watchPosition({
      profile: LocationProfile.AUTOMOTIVE_NAVIGATION,
      onPosition: (pos) => setFix({ t: pos.timestamp, accuracy: pos.horizontalAccuracy, mocked: pos.mocked }),
    });
    return () => {
      watch?.dispose();
      watch = undefined;
    };
  }, [granted, running]);

  const ok = (good: boolean, text: string) => (
    <T v="label" color={good ? p.success : p.hard.onTint}>
      {text}
    </T>
  );
  const fixText = !granted ? 'Location off' : running ? 'In use by the run' : !fix ? 'Waiting' : `${ago(now - fix.t)}, ${fix.accuracy === null ? '?' : Math.round(fix.accuracy)} m${fix.mocked ? ', mock' : ''}`;
  const fixFresh = fix !== undefined && now - fix.t < 10_000;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <T v="headline">Permissions and diagnostics</T>
        </View>

        <Section title="Permissions">
          <Group>
            <Row label="Location" sub="Precise, while using the app" onPress={access?.location === 'blocked' ? openAppSettings : access?.location !== 'granted' ? () => void requestLocation().then(refresh) : undefined}>
              {access && ok(access.location === 'granted', access.location === 'granted' ? 'Precise' : access.location === 'approximate' ? 'Approximate' : 'Not allowed')}
            </Row>
            <Row label="Background location" sub="Allow all the time" onPress={access && !access.background ? () => void requestBackground().then(refresh) : undefined}>
              {access && ok(access.background, access.background ? 'All the time' : 'While using')}
            </Row>
            <Row label="Notifications" sub="Run in progress notification" onPress={access && !access.notifications ? () => void requestNotifications().then(refresh) : undefined}>
              {access && ok(access.notifications, access.notifications ? 'Allowed' : 'Off')}
            </Row>
            <Row label="Battery limits" sub="Android may pause apps it limits" onPress={access?.batteryRestricted ? () => void requestBatteryExemption() : undefined} last>
              {access && ok(!access.batteryRestricted, access.batteryRestricted ? 'Limited' : 'Not limited')}
            </Row>
          </Group>
          {isSamsung() && (
            <T v="caption" tone="secondary" style={{ paddingHorizontal: 4 }}>
              On Samsung phones also add Fit to Never sleeping apps in Settings, Battery, Background usage limits.
            </T>
          )}
        </Section>

        <Section title="GPS">
          <Group>
            <Row label="Location services">{access && ok(access.servicesOn, access.servicesOn ? 'On' : 'Off')}</Row>
            <Row label="Last fix">{ok(running || fixFresh, fixText)}</Row>
            <Row label="Background delivery" sub="Registered while a run records" last>
              <T v="label" tone="secondary">
                {delivery === undefined ? '' : delivery ? 'Running' : 'Stopped'}
              </T>
            </Row>
          </Group>
        </Section>

        <Section title="Device">
          <Group>
            <Row label="Phone">
              <T v="label" tone="secondary">
                {`${Device.manufacturer ?? ''} ${Device.modelName ?? ''}`.trim()}
              </T>
            </Row>
            <Row label="Android" last>
              <T v="label" tone="secondary">
                {`${Device.osVersion ?? ''}, API ${Platform.Version}`}
              </T>
            </Row>
          </Group>
        </Section>

        <Button label="Open app settings" kind="outline" onPress={() => void openAppSettings()} />
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T v="labelStrong" tone="secondary">
        {title}
      </T>
      {children}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, gap: 20 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
}));
