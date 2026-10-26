import type { IdGen } from './dsl';
import { METERS_PER_MILE, type DistanceUnit } from './units';
import { isRepeat, type Activity, type Duration, type Step, type Target, type WorkoutItem } from './workout';

/**
 * Workout builder rules (spec §4 Builder UX, Rules). The screen edits a WorkoutItem[]
 * array; these helpers supply chip defaults, target defaults, validation, duplication
 * and the text form for quick text entry (the inverse of parseWorkout).
 */

export type BuilderChip = 'warmup' | 'run' | 'walk' | 'sprint' | 'repeat' | 'cooldown';

export interface BuilderOpts {
  /** "Easy runs by pace / by heart rate" (Settings.easyBy). */
  easyBy: 'pace' | 'hr';
}

export type TargetKind = 'pace' | 'hr' | 'effort' | 'speed' | 'none';

/** Default target when a step is added or its target type is switched (spec §4 picker). */
export function defaultTarget(activity: Activity, kind: TargetKind | undefined, opts: BuilderOpts): Target {
  const k = kind ?? (activity === 'sprint' ? 'effort' : activity === 'run' ? (opts.easyBy === 'hr' ? 'hr' : 'pace') : 'none');
  switch (k) {
    case 'pace':
      return { type: 'pace_zone', zone: 'easy' };
    case 'hr':
      return { type: 'hr_zone', zone: 2 };
    case 'effort':
      return { type: 'effort', rpe: activity === 'sprint' ? 9 : 6 };
    case 'speed':
      return { type: 'treadmill', speedKph: activity === 'walk' ? 5 : 9 };
    case 'none':
      return { type: 'none' };
  }
}

export function targetKind(target: Target): TargetKind {
  switch (target.type) {
    case 'pace_zone':
    case 'pace_range':
      return 'pace';
    case 'hr_zone':
    case 'hr_range':
    case 'hr_max':
      return 'hr';
    case 'effort':
      return 'effort';
    case 'treadmill':
      return 'speed';
    default:
      return 'none';
  }
}

/** Target kinds the picker offers for a step. Sprints are effort only (spec §4 rules). */
export function targetKinds(activity: Activity, mode: 'outdoor' | 'treadmill' | 'timer'): TargetKind[] {
  if (activity === 'sprint') return ['effort'];
  const kinds: TargetKind[] = ['pace', 'hr', 'effort', 'none'];
  return mode === 'treadmill' ? [...kinds.slice(0, 3), 'speed', 'none'] : kinds;
}

const step = (newId: IdGen, activity: Activity, seconds: number, opts: BuilderOpts, label?: string): Step => {
  const s: Step = { id: newId(), activity, duration: { type: 'time', seconds }, target: defaultTarget(activity, undefined, opts) };
  if (label) s.label = label;
  return s;
};

/** Quick-add chips: Warm up, Run, Walk, Sprint, Repeat, Cool down. */
export function itemFromChip(chip: BuilderChip, newId: IdGen, opts: BuilderOpts): WorkoutItem {
  switch (chip) {
    case 'warmup':
      return step(newId, 'walk', 300, opts, 'Warm up');
    case 'run':
      return step(newId, 'run', 600, opts);
    case 'walk':
      return step(newId, 'walk', 90, opts);
    case 'sprint':
      return step(newId, 'sprint', 30, opts);
    case 'repeat':
      return { id: newId(), repeat: 4, steps: [step(newId, 'sprint', 30, opts), step(newId, 'walk', 90, opts, 'Recover')] };
    case 'cooldown':
      return step(newId, 'walk', 300, opts, 'Cool down');
  }
}

/** Long-press duplicate: a deep copy with fresh ids. */
export function duplicateItem(item: WorkoutItem, newId: IdGen): WorkoutItem {
  if (isRepeat(item)) return { ...item, id: newId(), steps: item.steps.map((s) => ({ ...s, id: newId() })) };
  return { ...item, id: newId() };
}

export interface BuilderIssue {
  /** Index into items, and into a repeat's steps when set. */
  item: number;
  step?: number;
  message: string;
}

/** Problems that block saving. Messages follow the copy rules. */
export function validateItems(items: readonly WorkoutItem[]): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  if (items.length === 0) issues.push({ item: 0, message: 'Add at least one step' });
  const checkStep = (s: Step, item: number, stepIdx?: number) => {
    const at = (message: string) => issues.push(stepIdx === undefined ? { item, message } : { item, step: stepIdx, message });
    const d = s.duration;
    if ((d.type === 'time' && d.seconds <= 0) || (d.type === 'distance' && d.meters <= 0)) at('Set a duration');
    if (s.activity === 'sprint' && d.type !== 'time') at('Sprints are time based');
    if (s.activity === 'sprint' && s.target.type !== 'effort') at('Sprints use an effort target');
    const t = s.target;
    if (t.type === 'hr_range' && t.minBpm >= t.maxBpm) at('Heart rate range must go low to high');
    if (t.type === 'pace_range' && t.minSecPerKm >= t.maxSecPerKm) at('Pace range must go fast to slow');
    if (t.type === 'effort' && (t.rpe < 1 || t.rpe > 10)) at('Effort must be 1 to 10');
  };
  items.forEach((it, i) => {
    if (isRepeat(it)) {
      if (it.repeat < 1) issues.push({ item: i, message: 'Repeat at least once' });
      if (it.steps.length === 0) issues.push({ item: i, message: 'Add a step to the repeat' });
      it.steps.forEach((s, j) => checkStep(s, i, j));
    } else checkStep(it, i);
  });
  return issues;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function formatDuration(d: Duration, unit: DistanceUnit): string {
  if (d.type === 'open') return 'open';
  if (d.type === 'reps') return 'open';
  if (d.type === 'time') return d.seconds % 60 === 0 ? `${d.seconds / 60}min` : clock(d.seconds);
  if (d.meters < 1000 || (unit === 'km' && d.meters % 1000 !== 0 && d.meters < 5000)) return `${d.meters}m`;
  if (unit === 'mi') return `${Math.round((d.meters / METERS_PER_MILE) * 100) / 100}mi`;
  return `${Math.round(d.meters / 10) / 100}km`;
}

function formatTarget(t: Target, unit: DistanceUnit): string | undefined {
  const pace = (secPerKm: number) => clock(unit === 'mi' ? (secPerKm * METERS_PER_MILE) / 1000 : secPerKm);
  switch (t.type) {
    case 'pace_zone':
      return t.zone;
    case 'pace_range':
      return `${pace(t.minSecPerKm)}-${pace(t.maxSecPerKm)} /${unit}`;
    case 'hr_zone':
      return `Z${t.zone}`;
    case 'hr_range':
      return `${t.minBpm}-${t.maxBpm} bpm`;
    case 'hr_max':
      return `under ${t.maxBpm} bpm`;
    case 'effort':
      return `RPE ${t.rpe}`;
    default:
      return undefined;
  }
}

function formatStep(s: Step, unit: DistanceUnit): string {
  const label = s.label ? `${s.label}: ` : '';
  const target = formatTarget(s.target, unit);
  // "10min easy" reads better than "10min run @ easy"; parseWorkout reads both.
  if (s.activity === 'run' && s.target.type === 'pace_zone') return `${label}${formatDuration(s.duration, unit)} ${s.target.zone}`;
  return `${label}${formatDuration(s.duration, unit)} ${s.activity}${target ? ` @ ${target}` : ''}`;
}

/**
 * Text form of a workout for quick text entry, parseable by parseWorkout. Treadmill
 * speeds, strength and stretch targets have no text form and are dropped.
 */
export function formatWorkout(items: readonly WorkoutItem[], unit: DistanceUnit): string {
  return items.map((it) => (isRepeat(it) ? `${it.repeat}x [ ${it.steps.map((s) => formatStep(s, unit)).join(', ')} ]` : formatStep(it, unit))).join(', ');
}
