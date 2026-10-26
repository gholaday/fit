/**
 * Settings > Pace profile (spec §6): the current VDOT and where it came from, the zone paces
 * in your units, and the history. A recent race or a VDOT set by hand replaces it; a time
 * trial does too, from the run summary. Plan workouts store zones, so every future target
 * follows the new profile at once.
 */
import { TIME_TRIALS, vdotFromRace } from '@fit/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack, useUnits, useVdot } from '@/data/store';
import { RACES } from '@/features/setup/OnboardingSteps';
import { haptic } from '@/lib/haptics';
import { shortDate } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Chip, IconButton, NumStepper, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { TimeWheel } from '@/ui/Wheel';
import { PaceTable, sourceLabel, startTrial } from './paces';

type Editing = 'race' | 'manual' | undefined;

const RACE_CHOICES = [...RACES, { meters: 42195, label: 'Marathon', seconds: 270 * 60 }];

export function PaceProfileScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const unit = useUnits().distance;
  // The store's VDOT changes on every save, so the profile and history re-read with it.
  const vdot = useVdot();
  const profile = repo.paceProfile();
  const history = repo.paceHistory();
  const [editing, setEditing] = useState<Editing>();

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <T v="heading" accessibilityRole="header">
            Pace profile
          </T>
        </View>

        <View style={s.card}>
          {profile && vdot !== undefined ? (
            <>
              <View style={s.hero}>
                <View style={{ flex: 1 }}>
                  <T v="display" num>
                    {vdot.toFixed(1)}
                  </T>
                  <T v="label" tone="secondary">
                    VDOT
                  </T>
                </View>
                <View style={{ flex: 2, alignItems: 'flex-end' }}>
                  <T v="bodyMedium" align="right">
                    {sourceLabel(profile, unit)}
                  </T>
                  <T v="caption" tone="secondary">
                    {shortDate(profile.createdAt.slice(0, 10))}
                  </T>
                </View>
              </View>
              <PaceTable vdot={vdot} />
            </>
          ) : (
            <View style={{ paddingVertical: 14, gap: 4 }}>
              <T v="bodyMedium">No pace profile yet</T>
              <T v="caption" tone="secondary">
                Enter a recent race or run a time trial. Pace targets need one; until then runs use effort and heart rate.
              </T>
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Enter a recent race" kind={editing === 'race' ? 'primary' : 'outline'} size="md" style={{ flex: 1.4 }} onPress={() => setEditing(editing === 'race' ? undefined : 'race')} />
          <Button label="Set VDOT" kind={editing === 'manual' ? 'primary' : 'outline'} size="md" style={{ flex: 1 }} onPress={() => setEditing(editing === 'manual' ? undefined : 'manual')} />
        </View>
        {editing === 'race' && <RaceEntry onDone={() => setEditing(undefined)} />}
        {editing === 'manual' && <ManualEntry current={vdot} onDone={() => setEditing(undefined)} />}

        <View style={{ gap: 8 }}>
          <T v="labelStrong" tone="secondary">
            Time trials
          </T>
          <T v="caption" tone="tertiary">
            Run one all out; the summary offers the new paces when you finish.
          </T>
          <View style={s.chips}>
            {TIME_TRIALS.map((t) => (
              <Button key={t.id} label={t.name} kind="outline" size="sm" icon={<Icons.play size={12} color={p.text} />} onPress={() => startTrial(t)} />
            ))}
          </View>
        </View>

        {history.length > 1 && (
          <View style={{ gap: 8 }}>
            <T v="labelStrong" tone="secondary">
              History
            </T>
            <View style={s.card}>
              {history.map((h, i) => (
                <View key={h.id} style={[s.histRow, i > 0 && s.divider]}>
                  <T v="bodyStrong" num style={{ width: 52 }}>
                    {h.vdot.toFixed(1)}
                  </T>
                  <T v="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
                    {sourceLabel(h, unit)}
                  </T>
                  <T v="caption" tone="tertiary">
                    {shortDate(h.createdAt.slice(0, 10))}
                  </T>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      <StatusShade />
    </View>
  );
}

function RaceEntry({ onDone }: { onDone: () => void }) {
  const s = useStyles();
  const [race, setRace] = useState(RACE_CHOICES[1]!);
  const [seconds, setSeconds] = useState(race.seconds);
  const next = Math.round(vdotFromRace(race.meters, seconds) * 10) / 10;
  const save = () => {
    repo.setPaceProfile({ vdot: next, source: 'race', detail: { meters: race.meters, seconds } });
    actions.reload();
    haptic.success();
    showSnack({ message: `Paces updated to VDOT ${next.toFixed(1)}` });
    onDone();
  };
  return (
    <View style={[s.card, { paddingVertical: 14, gap: 12 }]}>
      <View style={s.chips}>
        {RACE_CHOICES.map((r) => (
          <Chip
            key={r.label}
            label={r.label}
            on={r.label === race.label}
            onPress={() => {
              setRace(r);
              setSeconds(r.seconds);
            }}
          />
        ))}
      </View>
      <TimeWheel label="Race time" seconds={seconds} maxMinutes={359} onChange={setSeconds} />
      <T v="body" tone="secondary" align="center" num>{`VDOT ${next.toFixed(1)}`}</T>
      <PaceTable vdot={next} />
      <Button label="Use these paces" onPress={save} />
    </View>
  );
}

function ManualEntry({ current, onDone }: { current: number | undefined; onDone: () => void }) {
  const s = useStyles();
  const [value, setValue] = useState(Math.round((current ?? 40) * 2) / 2);
  const save = () => {
    repo.setPaceProfile({ vdot: value, source: 'manual' });
    actions.reload();
    haptic.success();
    showSnack({ message: `Paces updated to VDOT ${value.toFixed(1)}` });
    onDone();
  };
  return (
    <View style={[s.card, { paddingVertical: 14, gap: 12 }]}>
      <View style={s.manual}>
        <T v="label" tone="secondary">
          VDOT
        </T>
        <NumStepper label="VDOT" value={value} min={20} max={85} step={0.5} format={(n) => n.toFixed(1)} onChange={setValue} />
      </View>
      <PaceTable vdot={value} before={current} />
      <Button label="Use these paces" disabled={current !== undefined && Math.abs(value - current) < 0.05} onPress={save} />
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, gap: 18 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14 },
  hero: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 14, paddingBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
  manual: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
}));
