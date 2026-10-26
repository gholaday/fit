/**
 * Onboarding steps that ask only what the plan needs: max heart rate (zones use Garmin's
 * percent-of-max method; the method picker lives in Settings) and starting fitness, as
 * Runna asks it. Every number is a stepper or a wheel, never the keyboard.
 */
import { type DistanceUnit, type HrProfileInput, type StartingFitness, DEFAULT_HR_METHOD, estimateMaxHr, metersToUnit, unitToMeters } from '@fit/core';
import { View } from 'react-native';
import { Group, NumStepper, Row, Segmented, T } from '@/ui/primitives';

function Header({ title, body }: { title: string; body: string }) {
  return (
    <View>
      <T v="display" style={{ fontSize: 26 }} accessibilityRole="header">
        {title}
      </T>
      <T v="body" tone="secondary" style={{ marginTop: 6, fontSize: 14, lineHeight: 20 }}>
        {body}
      </T>
    </View>
  );
}

const DEFAULT_AGE = 35;

/** Max heart rate, typed in with a stepper or estimated from age. */
export function HeartStep({ input, onChange }: { input: HrProfileInput; onChange: (i: HrProfileInput) => void }) {
  const known = input.maxHrSource === 'measured';
  const age = input.age ?? DEFAULT_AGE;
  return (
    <View style={{ gap: 18 }}>
      <Header title="Max heart rate" body="Sets your heart rate zones as a share of max, the way Garmin does. You can change the method in Settings." />
      <Segmented
        look="inset"
        options={[
          { value: 'age', label: 'Estimate from age' },
          { value: 'known', label: 'I know it' },
        ]}
        value={known ? 'known' : 'age'}
        onChange={(v) =>
          onChange(
            v === 'known'
              ? { method: DEFAULT_HR_METHOD, age: input.age, maxHr: input.maxHr ?? estimateMaxHr(age), maxHrSource: 'measured' }
              : { method: DEFAULT_HR_METHOD, age, maxHr: estimateMaxHr(age), maxHrSource: 'estimated' },
          )
        }
      />
      <Group>
        {!known && (
          <Row label="Age">
            <NumStepper label="Age" value={age} min={13} max={90} format={(n) => `${n} yr`} onChange={(n) => onChange({ method: DEFAULT_HR_METHOD, age: n, maxHr: estimateMaxHr(n), maxHrSource: 'estimated' })} />
          </Row>
        )}
        <Row label="Max heart rate" sub={known ? undefined : 'Estimated'} last>
          {known ? (
            <NumStepper label="Max heart rate" value={input.maxHr ?? estimateMaxHr(age)} min={120} max={220} format={(n) => `${n} bpm`} onChange={(n) => onChange({ ...input, method: DEFAULT_HR_METHOD, maxHr: n, maxHrSource: 'measured' })} />
          ) : (
            <T v="bodyStrong" num>{`${estimateMaxHr(age)} bpm`}</T>
          )}
        </Row>
      </Group>
    </View>
  );
}

/** Onboarding's HR profile: Garmin's method with an age estimate until the user knows better. */
export function defaultHeartInput(existing: HrProfileInput | undefined): HrProfileInput {
  if (existing?.maxHr) return { method: DEFAULT_HR_METHOD, age: existing.age, maxHr: existing.maxHr, maxHrSource: existing.maxHrSource ?? 'measured' };
  return { method: DEFAULT_HR_METHOD, age: DEFAULT_AGE, maxHr: estimateMaxHr(DEFAULT_AGE), maxHrSource: 'estimated' };
}

export const RACES: readonly { meters: number; label: string; seconds: number }[] = [
  { meters: 1609.344, label: '1 mi', seconds: 9 * 60 },
  { meters: 5000, label: '5K', seconds: 30 * 60 },
  { meters: 10000, label: '10K', seconds: 62 * 60 },
  { meters: 21097.5, label: 'Half', seconds: 135 * 60 },
];

export function defaultFitness(unit: DistanceUnit): StartingFitness {
  return { runsPerWeek: 2, weeklyDistanceM: unitToMeters(unit === 'mi' ? 8 : 12, unit), longestRunM: unitToMeters(unit === 'mi' ? 3 : 5, unit) };
}

/** Where you are now: runs per week, weekly distance and longest run. */
export function FitnessStep({ fitness, onChange, unit }: { fitness: StartingFitness; onChange: (f: StartingFitness) => void; unit: DistanceUnit }) {
  const set = (patch: Partial<StartingFitness>) => onChange({ ...fitness, ...patch });
  const weekly = Math.round(metersToUnit(fitness.weeklyDistanceM, unit));
  const longest = Math.round(metersToUnit(fitness.longestRunM, unit) * 2) / 2;
  return (
    <View style={{ gap: 18 }}>
      <Header title="Your running now" body="Sets the first week so it matches what you do now." />
      <Group>
        <Row label="Runs per week">
          <NumStepper label="Runs per week" value={fitness.runsPerWeek} min={0} max={7} onChange={(runsPerWeek) => set({ runsPerWeek })} />
        </Row>
        <Row label="Weekly distance" sub="Typical week lately">
          <NumStepper label="Weekly distance" value={weekly} min={0} max={100} format={(n) => `${n} ${unit}`} onChange={(n) => set({ weeklyDistanceM: unitToMeters(n, unit) })} />
        </Row>
        <Row label="Longest run" sub="In the last month" last>
          <NumStepper label="Longest run" value={longest} min={0} max={30} step={0.5} format={(n) => `${n} ${unit}`} onChange={(n) => set({ longestRunM: unitToMeters(n, unit) })} />
        </Row>
      </Group>
    </View>
  );
}
