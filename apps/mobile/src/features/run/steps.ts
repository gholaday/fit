/** How a workout step reads and which in-run gauge it gets. Display only; rules live in core. */
import {
  type DistanceUnit,
  type HrZoneBand,
  type Step,
  type StructureTone,
  formatBpmRange,
  formatClock,
  formatDistance,
  formatPaceRange,
  structureSegments,
} from '@fit/core';

const ACTIVITY_NAME: Record<Step['activity'], string> = {
  walk: 'Walk',
  run: 'Run',
  sprint: 'Sprint',
  rest: 'Rest',
  strength: 'Set',
  stretch: 'Stretch',
};

const ZONE_NAME: Record<string, string> = {
  easy: 'Easy',
  steady: 'Steady',
  tempo: 'Tempo',
  threshold: 'Threshold',
  interval: 'Interval',
  repetition: 'Repetition',
};

export function stepName(step: Step): string {
  if (step.label) return step.label;
  if (step.activity === 'run' && step.target.type === 'pace_zone') return ZONE_NAME[step.target.zone]!;
  if (step.activity === 'run' && step.target.type === 'hr_zone') return `Zone ${step.target.zone}`;
  return ACTIVITY_NAME[step.activity];
}

export function stepTone(step: Step): StructureTone {
  return structureSegments([step])[0]?.tone ?? 'easy';
}

/** "5:00", "400 m", "0.25 mi" or "Open". */
export function stepAmount(step: Step, unit: DistanceUnit): string {
  const d = step.duration;
  if (d.type === 'time') return formatClock(d.seconds);
  if (d.type === 'distance') return d.meters < 1000 && unit === 'km' ? `${d.meters} m` : formatDistance(d.meters, unit, 2);
  return 'Open';
}

export type Gauge = 'hr' | 'pace' | 'sprint' | 'timer';

export function gaugeFor(step: Step): Gauge {
  if (step.activity === 'sprint') return 'sprint';
  const t = step.target.type;
  if (t === 'hr_zone' || t === 'hr_range' || t === 'hr_max') return 'hr';
  if (t === 'pace_zone' || t === 'pace_range') return 'pace';
  if (t === 'effort' && step.target.type === 'effort' && step.target.rpe >= 9) return 'sprint';
  return 'timer';
}

/** Heart-rate target of a step as a bpm range, from the zones in the HR profile. */
export function hrRangeFor(step: Step, zones: readonly HrZoneBand[] | undefined): { minBpm: number; maxBpm: number } | undefined {
  const t = step.target;
  if (t.type === 'hr_range') return t;
  if (t.type === 'hr_max') return { minBpm: Math.round(t.maxBpm * 0.8), maxBpm: t.maxBpm };
  if (t.type === 'hr_zone') return zones?.find((z) => z.zone === t.zone);
  return undefined;
}

/** Second line under a step: its target, in words a runner reads at a glance. */
export function stepTargetText(
  step: Step,
  unit: DistanceUnit,
  pace: (s: Step) => { minSecPerKm: number; maxSecPerKm: number } | undefined,
  zones: readonly HrZoneBand[] | undefined,
): string | undefined {
  const t = step.target;
  if (t.type === 'pace_zone' || t.type === 'pace_range') {
    const r = pace(step);
    return r ? formatPaceRange(r.minSecPerKm, r.maxSecPerKm, unit) : t.type === 'pace_zone' ? `${ZONE_NAME[t.zone]} pace` : undefined;
  }
  const hr = hrRangeFor(step, zones);
  if (hr) return formatBpmRange(hr.minBpm, hr.maxBpm);
  if (t.type === 'effort') return t.rpe >= 9 ? 'All out' : `Effort ${t.rpe} of 10`;
  return undefined;
}

/** "Sprint 3 of 6": position among the steps of the same kind, for repeats. */
export function repLabel(steps: readonly Step[], idx: number): string | undefined {
  const step = steps[idx];
  if (!step) return undefined;
  const name = stepName(step);
  const same = steps.map((s, i) => [s, i] as const).filter(([s]) => s.activity === step.activity && stepName(s) === name);
  if (same.length < 2) return undefined;
  return `${name} ${same.findIndex(([, i]) => i === idx) + 1} of ${same.length}`;
}
