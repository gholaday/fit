/**
 * First-run setup for GPS recording (spec §5): precise location, then "Allow all the time"
 * with an explanation first, then notifications, then the battery exemption with the
 * Samsung tip. Only the missing steps show; each explains why before Android asks.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import Animated, { FadeIn, FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '@/lib/haptics';
import { createStyles, motion, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, T } from '@/ui/primitives';
import {
  isSamsung,
  openAppSettings,
  type RecordingAccess,
  readAccess,
  requestBackground,
  requestBatteryExemption,
  requestLocation,
  requestNotifications,
} from './permissions';

type StepId = 'location' | 'background' | 'notifications' | 'battery';

function missing(a: RecordingAccess): StepId[] {
  const out: StepId[] = [];
  if (a.location !== 'granted') out.push('location');
  if (!a.background) out.push('background');
  if (!a.notifications) out.push('notifications');
  if (a.batteryRestricted) out.push('battery');
  return out;
}

interface Copy {
  icon: ReactNode;
  title: string;
  body: string;
  action: string;
}

export function RunPermissions({ onDone, onUseTimer }: { onDone: () => void; onUseTimer: () => void }) {
  const p = usePalette();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [access, setAccess] = useState<RecordingAccess>();
  const [skipped, setSkipped] = useState<StepId[]>([]);
  // The steps as they were when the flow opened, so "2 of 4" keeps counting as steps clear.
  const [all, setAll] = useState<StepId[]>([]);

  const refresh = () =>
    void readAccess().then((a) => {
      setAccess(a);
      setAll((old) => (old.length > 0 ? old : missing(a)));
    });
  useEffect(refresh, []);
  // Coming back from system settings re-reads what changed there.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, []);

  const steps = access ? missing(access).filter((id) => !skipped.includes(id)) : [];
  const step = steps[0];
  useEffect(() => {
    if (access && !step) onDone();
  }, [access, step, onDone]);
  if (!access || !step) return <View style={s.screen} />;

  const blocked = step === 'location' && access.location === 'blocked';
  const copy: Record<StepId, Copy> = {
    location: {
      icon: <Icons.location size={28} color={p.run.color} />,
      title: 'Precise location',
      body: access.location === 'approximate' ? 'Approximate location is off by up to a few kilometers. Turn on precise location to record your route, distance and pace.' : 'Outdoor runs use GPS to record your route, distance and pace. Location is only used while a run is recording.',
      action: blocked ? 'Open settings' : 'Allow location',
    },
    background: {
      icon: <Icons.lock size={28} color={p.run.color} />,
      title: 'Keep recording with the screen off',
      body: 'On the next screen, choose Allow all the time. Without it, Android can stop GPS when the phone locks in your pocket.',
      action: 'Continue',
    },
    notifications: {
      icon: <Icons.bell size={28} color={p.run.color} />,
      title: 'Run notification',
      body: 'While you run, a notification shows distance and time and keeps the recording alive. It goes away when the run ends.',
      action: 'Allow notifications',
    },
    battery: {
      icon: <Icons.battery size={28} color={p.run.color} />,
      title: 'Battery limits',
      body: isSamsung()
        ? 'Allow Fit to run without battery limits. On Samsung phones also add Fit to Never sleeping apps in Settings, Battery, Background usage limits.'
        : 'Allow Fit to run without battery limits, so Android does not pause recording during long runs.',
      action: 'Allow',
    },
  };
  const c = copy[step];

  const act = async () => {
    haptic.commit();
    if (step === 'location') {
      if (blocked) await openAppSettings();
      else await requestLocation();
    } else if (step === 'background') await requestBackground();
    else if (step === 'notifications') await requestNotifications();
    else await requestBatteryExemption();
    refresh();
  };

  return (
    <Animated.View entering={FadeIn.duration(motion.fast)} style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={s.top}>
        <IconButton label="Close" size={44} onPress={step === 'location' ? onUseTimer : onDone}>
          <Icons.x size={20} color={p.text} />
        </IconButton>
        <T v="caption" tone="secondary">
          {`${all.indexOf(step) + 1} of ${all.length}`}
        </T>
      </View>
      <Animated.View key={step} entering={FadeInRight.duration(motion.slow)} style={s.body}>
        <View style={s.icon}>{c.icon}</View>
        <T v="title" accessibilityRole="header">
          {c.title}
        </T>
        <T v="body" tone="secondary">
          {c.body}
        </T>
      </Animated.View>
      <View style={s.footer}>
        <Button label={c.action} onPress={act} />
        {step === 'location' ? (
          <Button label="Use Timer mode" kind="quiet" onPress={onUseTimer} />
        ) : (
          <Button label="Not now" kind="quiet" onPress={() => setSkipped([...skipped, step])} />
        )}
      </View>
    </Animated.View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.bg, paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginLeft: -4 },
  body: { flex: 1, justifyContent: 'center', gap: 12, paddingBottom: 60 },
  icon: { width: 56, height: 56, borderRadius: 16, backgroundColor: p.run.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  footer: { gap: 8 },
}));
