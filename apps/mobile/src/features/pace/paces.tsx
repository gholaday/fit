/**
 * Pace profile pieces shared by the summary, Today, Settings and the Library (spec §6): the
 * zone pace table (optionally against the current one), the "Update your paces?" card after
 * a trial, the +1 VDOT prompt, and starting a built-in time trial.
 */
import { type DistanceUnit, METERS_PER_MILE, PACE_ZONES, type PaceProfile, type TIME_TRIALS, type TrialResult, formatClock, formatDistance, formatPaceRange, paceTable, paceToUnit, parseWorkout } from '@fit/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { newId, repo } from '@/data';
import { actions, showSnack, useUnits } from '@/data/store';
import { ZONE_LABEL } from '@/features/builder/StepEditor';
import { RACES } from '@/features/setup/OnboardingSteps';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Button, T } from '@/ui/primitives';

/** "5K, 24:30" or "3.00 km, 14:10" for a race or trial. */
export function effortLabel(d: { meters: number; seconds: number }, unit: DistanceUnit): string {
  const race = RACES.find((r) => Math.abs(r.meters - d.meters) < 1);
  const km = d.meters / 1000;
  const name = race ? race.label : Math.abs(d.meters - METERS_PER_MILE) < 1 ? '1 mi' : Number.isInteger(km) ? `${km} km` : formatDistance(d.meters, unit, 2);
  return `${name}, ${formatClock(d.seconds)}`;
}

const SOURCE: Record<PaceProfile['source'], string> = { trial: 'From a time trial', race: 'From a race', manual: 'Set by hand', goal: 'From your goal' };

/** "From a race, 5K, 24:30" or "Set by hand". */
export function sourceLabel(profile: PaceProfile, unit: DistanceUnit): string {
  return profile.detail ? `${SOURCE[profile.source]}, ${effortLabel(profile.detail, unit)}` : SOURCE[profile.source];
}

/** Seconds per display unit faster (negative) or slower than before, at the zone's target. */
function change(next: number, before: number, unit: DistanceUnit): string {
  const d = Math.round(paceToUnit(next, unit) - paceToUnit(before, unit));
  if (d === 0) return 'Same';
  const a = Math.abs(d);
  const amount = a < 60 ? `${a} s` : a % 60 === 0 ? `${a / 60} min` : `${Math.floor(a / 60)} min ${a % 60} s`;
  return `${amount} ${d < 0 ? 'faster' : 'slower'}`;
}

/** Zone paces for a VDOT; with `before`, each row also says how much it moved. */
export function PaceTable({ vdot, before }: { vdot: number; before?: number }) {
  const s = useStyles();
  const unit = useUnits().distance;
  const table = paceTable(vdot);
  const old = before !== undefined ? paceTable(before) : undefined;
  return (
    <View>
      {PACE_ZONES.map((z, i) => (
        <View key={z} style={[s.row, i > 0 && s.divider]}>
          <T v="bodyMedium" style={{ width: 96 }}>
            {ZONE_LABEL[z]}
          </T>
          <T v="bodyStrong" num style={{ flex: 1 }}>
            {formatPaceRange(table[z].minSecPerKm, table[z].maxSecPerKm, unit)}
          </T>
          {old && (
            <T v="caption" tone="secondary" num>
              {change(table[z].targetSecPerKm, old[z].targetSecPerKm, unit)}
            </T>
          )}
        </View>
      ))}
    </View>
  );
}

/** "Update your paces?" on the summary of a run with a time trial (or the plans' retest). */
export function TrialCard({ sessionId, trial, current }: { sessionId: string; trial: TrialResult; current: number | undefined }) {
  const s = useStyles();
  const unit = useUnits().distance;
  const [done, setDone] = useState(false);
  if (done || (current !== undefined && Math.abs(trial.vdot - current) < 0.05)) return null;
  const accept = () => {
    repo.setPaceProfile({ vdot: trial.vdot, source: 'trial', detail: { meters: trial.meters, seconds: trial.seconds }, sessionId });
    actions.reload();
    haptic.success();
    setDone(true);
    showSnack({ message: `Paces updated to VDOT ${trial.vdot.toFixed(1)}` });
  };
  return (
    <View style={s.card}>
      <T v="headline" style={s.title}>
        Update your paces?
      </T>
      <T v="body" tone="secondary" style={{ paddingBottom: 6 }}>
        {current !== undefined
          ? `${effortLabel(trial, unit)} gives VDOT ${trial.vdot.toFixed(1)}, ${trial.vdot > current ? 'up' : 'down'} from ${current.toFixed(1)}. Every future workout uses the new paces.`
          : `${effortLabel(trial, unit)} gives VDOT ${trial.vdot.toFixed(1)}. Every future workout uses these paces.`}
      </T>
      <PaceTable vdot={trial.vdot} before={current} />
      <View style={s.buttons}>
        <Button label="Keep current" kind="quiet" size="md" style={{ flex: 1 }} onPress={() => (haptic.tap(), setDone(true))} />
        <Button label="Update paces" size="md" style={{ flex: 1.3 }} onPress={accept} />
      </View>
    </View>
  );
}

/** The +1 VDOT prompt. Never applied without Accept. */
export function PaceBumpCard({ bump }: { bump: { from: number; to: number } }) {
  const s = useStyles();
  const p = usePalette();
  const accept = () => {
    repo.setPaceProfile({ vdot: bump.to, source: 'manual' });
    actions.reload();
    haptic.success();
    showSnack({ message: `Paces updated to VDOT ${bump.to.toFixed(1)}` });
  };
  const notNow = () => {
    haptic.tap();
    repo.dismissPaceBump();
    actions.reload();
  };
  return (
    <View style={[s.card, { borderWidth: 1, borderColor: p.hard.color }]}>
      <T v="headline" style={s.title}>
        Faster than target
      </T>
      <T v="body" tone="secondary">
        {`Your intervals are faster than target. Raise VDOT from ${bump.from.toFixed(1)} to ${bump.to.toFixed(1)}?`}
      </T>
      <View style={s.buttons}>
        <Button label="Not now" kind="quiet" size="md" style={{ flex: 1 }} onPress={notNow} />
        <Button label={`Raise to ${bump.to.toFixed(1)}`} size="md" style={{ flex: 1.3 }} onPress={accept} />
      </View>
    </View>
  );
}

export type TimeTrial = (typeof TIME_TRIALS)[number];

/** Built-in trials are read-only: each start saves a one-off copy and opens the pre-start. */
export function startTrial(trial: TimeTrial): void {
  haptic.commit();
  const id = repo.saveWorkout({ name: trial.name, items: parseWorkout(trial.dsl, newId), defaultMode: 'outdoor', template: false });
  router.push({ pathname: '/run', params: { workoutId: id } });
}

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14, paddingBottom: 14 },
  title: { paddingTop: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
  buttons: { flexDirection: 'row', gap: 8, paddingTop: 12 },
}));
