/** Workout model (spec §4, §7). Targets live on each step, never on the workout. */

export type Activity = 'walk' | 'run' | 'sprint' | 'rest' | 'strength' | 'stretch';

export type Duration =
  | { type: 'time'; seconds: number }
  | { type: 'distance'; meters: number }
  | { type: 'open' }
  | { type: 'reps' };

export type PaceZone = 'easy' | 'steady' | 'tempo' | 'threshold' | 'interval' | 'repetition';
export const PACE_ZONES: readonly PaceZone[] = ['easy', 'steady', 'tempo', 'threshold', 'interval', 'repetition'];

export type HrZone = 1 | 2 | 3 | 4 | 5;

export type Target =
  | { type: 'none' }
  | { type: 'pace_zone'; zone: PaceZone }
  | { type: 'pace_range'; minSecPerKm: number; maxSecPerKm: number }
  | { type: 'hr_zone'; zone: HrZone }
  | { type: 'hr_range'; minBpm: number; maxBpm: number }
  | { type: 'hr_max'; maxBpm: number }
  | { type: 'effort'; rpe: number }
  | { type: 'treadmill'; speedKph: number; inclinePct?: number }
  | { type: 'strength'; exerciseId: string; reps: number; weightKg?: number }
  | { type: 'stretch'; stretchId: string; sides: 'both' | 'none'; reps?: number };

export interface HrGuard {
  capBpm?: number;
  walkWhenAbove?: boolean;
}

export interface Step {
  id: string;
  label?: string;
  activity: Activity;
  duration: Duration;
  target: Target;
  cue?: string;
  hrGuard?: HrGuard;
}

export interface RepeatBlock {
  id: string;
  repeat: number;
  steps: Step[];
}

export type WorkoutItem = Step | RepeatBlock;

export type WorkoutKind = 'run' | 'strength' | 'mobility' | 'mixed';
export type SessionMode = 'outdoor' | 'treadmill' | 'timer';

export interface Workout {
  id: string;
  name: string;
  kind: WorkoutKind;
  items: WorkoutItem[];
  defaultMode: SessionMode;
  notes?: string;
}

/** Version of the `items_json` shape stored in SQLite. Bump on breaking changes. */
export const WORKOUT_ITEMS_SCHEMA_VERSION = 1;

export function isRepeat(item: WorkoutItem): item is RepeatBlock {
  return 'repeat' in item;
}

/** Steps in play order, with repeat blocks expanded. */
export function flattenSteps(items: readonly WorkoutItem[]): Step[] {
  const out: Step[] = [];
  for (const item of items) {
    if (isRepeat(item)) {
      for (let i = 0; i < item.repeat; i++) out.push(...item.steps);
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Pace resolver: seconds per km for a step, used to estimate time for distance steps
 * and distance for time steps. Returns undefined when pace is unknown (walk, effort).
 */
export type PaceLookup = (step: Step) => number | undefined;

/** Rough defaults when no pace profile exists yet. */
const FALLBACK_SEC_PER_KM: Record<Activity, number | undefined> = {
  walk: 600,
  run: 400,
  sprint: 240,
  rest: undefined,
  strength: undefined,
  stretch: undefined,
};

export function stepSeconds(step: Step, pace?: PaceLookup): number {
  switch (step.duration.type) {
    case 'time':
      return step.duration.seconds;
    case 'distance': {
      const secPerKm = pace?.(step) ?? FALLBACK_SEC_PER_KM[step.activity] ?? 400;
      return (step.duration.meters / 1000) * secPerKm;
    }
    default:
      return 0;
  }
}

export function stepMeters(step: Step, pace?: PaceLookup): number {
  switch (step.duration.type) {
    case 'distance':
      return step.duration.meters;
    case 'time': {
      const secPerKm = pace?.(step) ?? FALLBACK_SEC_PER_KM[step.activity];
      return secPerKm ? (step.duration.seconds / secPerKm) * 1000 : 0;
    }
    default:
      return 0;
  }
}

export function totalSeconds(items: readonly WorkoutItem[], pace?: PaceLookup): number {
  return flattenSteps(items).reduce((sum, s) => sum + stepSeconds(s, pace), 0);
}

export function totalMeters(items: readonly WorkoutItem[], pace?: PaceLookup): number {
  return flattenSteps(items).reduce((sum, s) => sum + stepMeters(s, pace), 0);
}

/**
 * Color class for the structure bar. Maps to activity colors in design.md:
 * easy (dusty blue), hard (amber), sprint (clay), walk (grey).
 */
export type StructureTone = 'easy' | 'hard' | 'sprint' | 'walk';

export interface StructureSegment {
  tone: StructureTone;
  /** Fraction of total workout time, 0..1. Segments sum to 1. */
  fraction: number;
}

function toneOf(step: Step): StructureTone {
  if (step.activity === 'sprint') return 'sprint';
  if (step.activity === 'walk' || step.activity === 'rest') return 'walk';
  const t = step.target;
  if (t.type === 'pace_zone' && t.zone !== 'easy' && t.zone !== 'steady') return 'hard';
  if (t.type === 'pace_range') return 'hard';
  if (t.type === 'hr_zone' && t.zone >= 4) return 'hard';
  if (t.type === 'effort' && t.rpe >= 7) return 'hard';
  return 'easy';
}

/** Proportional colored segments for the signature structure bar. Adjacent same-tone steps merge. */
export function structureSegments(items: readonly WorkoutItem[], pace?: PaceLookup): StructureSegment[] {
  const steps = flattenSteps(items);
  const total = steps.reduce((sum, s) => sum + stepSeconds(s, pace), 0);
  if (total <= 0) return [];
  const out: StructureSegment[] = [];
  for (const step of steps) {
    const fraction = stepSeconds(step, pace) / total;
    if (fraction <= 0) continue;
    const tone = toneOf(step);
    const last = out[out.length - 1];
    if (last && last.tone === tone) last.fraction += fraction;
    else out.push({ tone, fraction });
  }
  return out;
}
