import { ZONE_NAMES, zoneBand } from '@fit/core';
import { router } from 'expo-router';
import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions, useHrProfile, usePlan, useSettings, useToday } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { monthDay, thousands } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Group, IconButton, Row, Segmented, Stepper, T } from '@/ui/primitives';

const METHOD_LABEL = { hrr: 'HR reserve', max: '% of max', maf: 'MAF', lthr: 'Threshold', custom: 'Custom' } as const;

export function SettingsScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
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
              sub={hr && z2 ? `${METHOD_LABEL[hr.method]}, Zone 2 ${ZONE_NAMES[2].toLowerCase()} ${z2.minBpm}-${z2.maxBpm} bpm` : 'Not set'}
              onPress={() => router.push({ pathname: '/setup', params: { only: 'zones' } })}
            >
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
            <Row label="Running plan" sub={plan ? (today < plan.startDate ? `${plan.name}, starts ${monthDay(plan.startDate)}` : `${plan.name}, week ${plan.currentWeek} of ${plan.weeks}`) : 'None'} onPress={() => router.push({ pathname: '/setup', params: { only: 'plan' } })}>
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
            <Row label="Post-run stretch" sub="Offer a stretch on the run summary" last>
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

        <Section title="Recording">
          <Group>
            <Row label="Permissions and diagnostics" sub="GPS, background access, battery limits" onPress={() => router.push('/diagnostics')} last>
              <Icons.chevronRight size={18} color={p.textTertiary} />
            </Row>
          </Group>
        </Section>

        <Section title="Coming later">
          <Group>
            <Row label="Health Connect" sub="Steps, resting heart rate and Garmin sessions" />
            <Row label="Heart rate sensor" sub="Live heart rate from your watch" />
            <Row label="Backup and export" sub="Sync to the cloud and export your data" last />
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

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  content: { padding: 20, gap: 20 },
}));
