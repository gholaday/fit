/**
 * Settings > Heart rate sensor (spec §7): scan for Heart Rate service devices, pick one,
 * remember it. Runs reconnect to the remembered sensor at pre-start.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions, useSettings } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, motion, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Group, IconButton, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { holdSensor, sensorChanged, useHrLive } from './live';
import { type HrDevice, bluetoothOn, requestSensorPermissions, sensorAvailable, startScan, stopScan, useSensor } from './sensor';

type Blocker = 'unsupported' | 'off' | 'denied';

const BLOCKER_TEXT: Record<Blocker, string> = {
  unsupported: 'This phone does not support Bluetooth LE sensors.',
  off: 'Turn on Bluetooth to scan for sensors.',
  denied: 'Fit needs the Nearby devices permission to find sensors. Allow it in system settings.',
};

/** Signal strength in words; RSSI is dBm, closer to 0 is stronger. */
const signalText = (rssi: number) => (rssi > -60 ? 'Strong signal' : rssi > -80 ? 'Good signal' : 'Weak signal');

export function SensorScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const remembered = useSettings().hrSensor;
  const devices = useSensor((x) => x.devices);
  const scanning = useSensor((x) => x.scanning);
  const connection = useSensor((x) => x.connection);
  const failure = useSensor((x) => x.failure);
  const bpm = useHrLive((h) => h.bpm);
  const [blocker, setBlocker] = useState<Blocker>();

  // Connected to the remembered sensor while open, so its reading shows here.
  useEffect(() => {
    const release = holdSensor();
    return () => {
      stopScan();
      release();
    };
  }, []);

  const scan = async () => {
    haptic.tap();
    if (!sensorAvailable()) return setBlocker('unsupported');
    if (!(await requestSensorPermissions())) return setBlocker('denied');
    if (!bluetoothOn()) return setBlocker('off');
    setBlocker(undefined);
    if (!startScan()) setBlocker('off');
  };

  const pick = (d: HrDevice) => {
    haptic.commit();
    stopScan();
    actions.updateSettings({ hrSensor: { id: d.id, name: d.name ?? 'Heart rate sensor' } });
    sensorChanged();
  };

  const status = !remembered
    ? undefined
    : bpm !== undefined
      ? `${bpm} bpm`
      : connection === 'connected'
        ? 'Connected, waiting for a reading'
        : connection === 'failed'
          ? failure === 'no-hr-service'
            ? 'This device does not send heart rate'
            : 'Not in range, retrying'
          : connection === 'reconnecting'
            ? 'Reconnecting'
            : 'Connecting';
  const others = devices.filter((d) => d.id !== remembered?.id);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <T v="heading" accessibilityRole="header">
            Heart rate sensor
          </T>
        </View>
        <T v="body" tone="secondary">
          Pair a chest strap or a watch that broadcasts heart rate. On a Garmin watch, turn on Broadcast heart rate before you scan.
        </T>

        {remembered && (
          <View style={{ gap: 8 }}>
            <T v="labelStrong" tone="secondary">
              Your sensor
            </T>
            <Group>
              <View style={s.device}>
                <Icons.heart size={22} color={bpm !== undefined ? p.run.color : p.textTertiary} />
                <View style={{ flex: 1 }}>
                  <T v="bodyMedium" numberOfLines={1}>
                    {remembered.name}
                  </T>
                  <T v="caption" tone="secondary">
                    {status}
                  </T>
                </View>
                {bpm === undefined && connection !== 'failed' && <ActivityIndicator size="small" color={p.textTertiary} />}
              </View>
            </Group>
            <T v="caption" tone="tertiary">
              Runs connect to it when you open the start screen.
            </T>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <View style={s.sectionHead}>
            <T v="labelStrong" tone="secondary" style={{ flex: 1 }}>
              {remembered ? 'Other sensors' : 'Sensors nearby'}
            </T>
            {scanning && <ActivityIndicator size="small" color={p.textTertiary} />}
          </View>
          {others.length > 0 && (
            <Group>
              {others.map((d, i) => (
                <Animated.View key={d.id} entering={FadeIn.duration(motion.fast)}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Use ${d.name ?? 'unnamed sensor'}`} onPress={() => pick(d)} style={({ pressed }) => [s.device, i < others.length - 1 && s.divider, { opacity: pressed ? 0.6 : 1 }]}>
                    <Icons.heart size={22} color={p.textTertiary} />
                    <View style={{ flex: 1 }}>
                      <T v="bodyMedium" numberOfLines={1}>
                        {d.name ?? 'Unnamed sensor'}
                      </T>
                      <T v="caption" tone="secondary">
                        {signalText(d.rssi)}
                      </T>
                    </View>
                    <T v="labelStrong" color={p.primary}>
                      Use
                    </T>
                  </Pressable>
                </Animated.View>
              ))}
            </Group>
          )}
          {scanning && others.length === 0 && (
            <T v="caption" tone="tertiary">
              Looking for sensors. Keep the sensor close and awake.
            </T>
          )}
          {blocker && (
            <View style={s.notice}>
              <Icons.info size={18} color={p.hard.onTint} />
              <T v="label" color={p.hard.onTint} style={{ flex: 1 }}>
                {BLOCKER_TEXT[blocker]}
              </T>
            </View>
          )}
          <Button label={scanning ? 'Stop scanning' : 'Scan for sensors'} kind={remembered ? 'quiet' : 'primary'} size="md" onPress={scanning ? stopScan : () => void scan()} />
        </View>
      </ScrollView>
      <StatusShade />
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, gap: 20 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', minHeight: 20 },
  device: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: p.divider },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: p.hard.tint },
}));
