import { type CuePrefs, DEFAULT_CUE_PREFS, zoneBand } from '@fit/core';
import { router } from 'expo-router';
import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions, useHrProfile, usePlan, useSettings, useToday, useVdot } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { monthDay, thousands } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Group, IconButton, Row, Segmented, Stepper, T } from '@/ui/primitives';

export function SettingsScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const vdot = useVdot();
  const hr = useHrProfile();
  const plan = usePlan();
  const today = useToday();
  const z2 = hr ? zoneBand(hr.zones, 2) : undefined;

  return (
    <View style={s.screen}>
      <View style={[s.top, { paddingTop: insets.top + 12 }]}>
        <IconButton label="Back" size={40} onPress={() => router.back()}>
          <Icons.chevronLeft size={20} color={p.text} />
        </IconButton>
        <T v="heading" accessibilityRole="header">
          Settings
        </T>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}>
        <Section title="Appearance">
          <Segmented
            look="inset"
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={settings.appearance}
            onChange={(appearance) => actions.updateSettings({ appearance })}
          />
        </Section>

        <Section title="Units">
          <View style={{ gap: 8 }}>
            <Segmented
              look="inset"
              options={[
                { value: 'mi', label: 'Miles' },
                { value: 'km', label: 'Kilometers' },
              ]}
              value={settings.units.distance}
              onChange={(distance) => actions.updateSettings({ units: { ...settings.units, distance } })}
            />
            <Segmented
              look="inset"
              options={[
                { value: 'lb', label: 'Pounds' },
                { value: 'kg', label: 'Kilograms' },
              ]}
              value={settings.units.weight}
              onChange={(weight) => actions.updateSettings({ units: { ...settings.units, weight } })}
            />
          </View>
        </Section>

        <Section title="Activity">
          <Group>
            <Row label="Daily step goal" last>
              <Stepper
                value={thousands(settings.stepGoal)}
                minusLabel="Lower step goal"
                plusLabel="Raise step goal"
                onMinus={() => actions.updateSettings({ stepGoal: Math.max(1000, settings.stepGoal - 500) })}
                onPlus={() => actions.updateSettings({ stepGoal: settings.stepGoal + 500 })}
              />
            </Row>
          </Group>
        </Section>

        <Section title="Training">
          <Group>
            <Row
              label="Heart rate zones"
              sub={hr && z2 ? `Zone 2 is ${z2.minBpm} to ${z2.maxBpm} bpm` : 'Not set'}
              onPress={() => router.push({ pathname: '/setup', params: { only: 'zones' } })}
            >
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
            <Row label="Pace profile" sub={vdot !== undefined ? `VDOT ${vdot.toFixed(1)}` : 'Not set'} onPress={() => router.push('/pace')}>
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
            <Row label="Running plan" sub={plan ? (today < plan.startDate ? `${plan.name}, starts ${monthDay(plan.startDate)}` : `${plan.name}, week ${plan.currentWeek} of ${plan.weeks}`) : 'No plan'} onPress={() => router.push({ pathname: '/setup', params: { only: 'plan' } })}>
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
            <Row label="Post-run stretch" sub="Suggest a stretch after each run" last>
              <Switch
                value={settings.postRunStretch}
                onValueChange={(postRunStretch) => {
                  haptic.tick();
                  actions.updateSettings({ postRunStretch });
                }}
                trackColor={{ true: p.primary, false: p.border }}
                thumbColor={p.surface}
                accessibilityLabel="Post-run stretch"
              />
            </Row>
          </Group>
        </Section>

        <Section title="Voice cues">
          <CueSwitches />
        </Section>

        <Section title="Recording">
          <Group>
            <Row label="Health Connect" sub="Import steps, heart rate and watch workouts" onPress={() => router.push('/health-connect')}>
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
            <Row label="Heart rate sensor" sub={settings.hrSensor ? settings.hrSensor.name : 'Not paired'} onPress={() => router.push('/hr-sensor')}>
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
            <Row label="Permissions and diagnostics" sub="Check GPS, background and battery settings" onPress={() => router.push('/diagnostics')} last>
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
          </Group>
        </Section>

        <Section title="Coming later">
          <Group>
            <Row label="Backup and export" sub="Back up to the cloud and export your data" last />
          </Group>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T v="labelStrong" tone="secondary">
        {title}
      </T>
      {children}
    </View>
  );
}

type CueToggle = Exclude<keyof CuePrefs, 'splits'>;

const CUE_ROWS: readonly { key: CueToggle; label: string; sub: string }[] = [
  { key: 'halfway', label: 'Halfway', sub: 'Say when you are halfway through a step of 3 min or longer' },
  { key: 'paceNudge', label: 'Pace nudges', sub: 'Say when you are faster or slower than your target pace' },
  { key: 'hrAlerts', label: 'Heart rate alerts', sub: 'Say when your heart rate goes above your zone and when it comes back' },
  { key: 'hrBelow', label: 'Below the range', sub: 'Say when your heart rate drops below your zone' },
  { key: 'zoneUpdates', label: 'Zone updates', sub: 'Say your heart rate zone every 5 min on heart rate steps' },
];

function CueSwitches() {
  const p = usePalette();
  const settings = useSettings();
  const cues = settings.cues ?? DEFAULT_CUE_PREFS;
  const set = (patch: Partial<CuePrefs>) => {
    haptic.tick();
    actions.updateSettings({ cues: { ...cues, ...patch } });
  };
  const sw = (value: boolean, label: string, onChange: (v: boolean) => void) => (
    <Switch value={value} onValueChange={onChange} trackColor={{ true: p.primary, false: p.border }} thumbColor={p.surface} accessibilityLabel={label} />
  );
  return (
    <Group>
      <Row label="Splits" sub={`Say your time and pace every ${settings.units.distance === 'km' ? 'kilometer' : 'mile'}`}>
        {sw(cues.splits === 'every', 'Splits', (on) => set({ splits: on ? 'every' : 'off' }))}
      </Row>
      {CUE_ROWS.map((r, i) => (
        <Row key={r.key} label={r.label} sub={r.sub} last={i === CUE_ROWS.length - 1}>
          {sw(cues[r.key], r.label, (on) => set({ [r.key]: on }))}
        </Row>
      ))}
    </Group>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  content: { padding: 20, gap: 20 },
}));
