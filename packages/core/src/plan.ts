import type { PlanRole } from './agenda';
import { addDays, diffDays, startOfWeek, weekdayOf, type IsoDate, type Weekday } from './dates';
import { parseWorkout, renderTemplate, type IdGen } from './dsl';
import { isHardRole } from './moving';
import type { PlanInputs, PlanPresetId } from './repository';
import { vdotFromRace } from './vdot';
import type { SessionMode, Step, Target, Workout, WorkoutItem } from './workout';
import { flattenSteps, isRepeat, stepSeconds, totalMeters, type PaceLookup } from './workout';

/**
 * Plan engine, M0 subset (spec §7, §8): 5K and Zone 2 Base presets with a simple
 * scheduler. Pure: same inputs, same plan.
 */

interface Ramp {
  start: number;
  peak: number;
  /** 1-based week the peak is reached; held afterwards. Defaults to the last non-taper week. */
  peakWeek?: number;
}

interface SessionTemplate {
  name: string;
  dsl: string;
}

interface PresetDef {
  id: PlanPresetId;
  name: string;
  subtitle: string;
  kind: 'race' | 'fitness';
  measure: 'distance' | 'z2_minutes';
  weeks: number;
  daysPerWeek: { min: number; max: number; default: number };
  cutbackEvery?: number;
  taperWeeks: number;
  retestWeeks: number[];
  retest: SessionTemplate;
  /** Roles by priority; the first `daysPerWeek` survive. */
  slots: PlanRole[];
  /** Values ramped from start to peak across build weeks. */
  ramps: Record<string, Ramp>;
  /** Build the session for a role in a week from the ramped values. */
  session(role: PlanRole, week: number, vars: Record<string, number>): SessionTemplate;
  race?: SessionTemplate;
}

const FIVE_K: PresetDef = {
  id: '5k-8wk',
  name: '5K',
  subtitle: '8 weeks, intervals, tempo and long runs',
  kind: 'race',
  measure: 'distance',
  weeks: 8,
  daysPerWeek: { min: 3, max: 5, default: 4 },
  cutbackEvery: 4,
  taperWeeks: 1,
  retestWeeks: [4],
  retest: { name: '5K time trial', dsl: 'Warm up: 10m easy, 3km @ RPE 9, Cool down: 10m easy' },
  slots: ['long', 'quality', 'easy', 'quality2', 'easy2'],
  ramps: {
    longKm: { start: 6, peak: 10, peakWeek: 6 },
    easyMin: { start: 25, peak: 40, peakWeek: 6 },
    reps: { start: 4, peak: 8, peakWeek: 6 },
    tempoMin: { start: 12, peak: 24, peakWeek: 6 },
  },
  session(role, week, v) {
    switch (role) {
      case 'long':
        return { name: 'Long run', dsl: `${v.longKm}km easy` };
      case 'quality':
        return week % 2 === 1
          ? { name: 'Intervals', dsl: `Warm up: 10m easy, ${v.reps}x [ 400m @ interval, 90s walk ], Cool down: 10m easy` }
          : { name: 'Tempo run', dsl: `Warm up: 10m easy, ${v.tempoMin}min @ tempo, Cool down: 10m easy` };
      case 'quality2':
        return { name: 'Hills', dsl: `Warm up: 10m easy, ${v.reps}x [ 60s @ RPE 8, 90s walk ], Cool down: 10m easy` };
      default:
        return { name: 'Easy run', dsl: `${v.easyMin}min easy` };
    }
  },
  race: { name: '5K race', dsl: 'Warm up: 10m easy, 5km @ RPE 9' },
};

const Z2_SESSION = 'Warm up: 5m walk, {{min}}min @ Z2, Cool down: 5m walk';

const ZONE2_BASE: PresetDef = {
  id: 'z2-base-8wk',
  name: 'Zone 2 Base',
  subtitle: 'Heart rate based, builds aerobic base',
  kind: 'fitness',
  measure: 'z2_minutes',
  weeks: 8,
  daysPerWeek: { min: 3, max: 5, default: 4 },
  cutbackEvery: 4,
  taperWeeks: 0,
  retestWeeks: [1, 4, 8],
  retest: { name: 'Aerobic test', dsl: 'Warm up: 5m walk, 30min @ Z2, Cool down: 5m walk' },
  slots: ['long', 'easy', 'easy2', 'easy3', 'easy4'],
  ramps: {
    weekMin: { start: 90, peak: 200, peakWeek: 7 },
    longMin: { start: 45, peak: 75, peakWeek: 7 },
  },
  session(role, _week, v) {
    if (role === 'long') return { name: 'Zone 2 Long', dsl: renderTemplate(Z2_SESSION, { min: v.longMin! }) };
    return { name: 'Zone 2 Run', dsl: renderTemplate(Z2_SESSION, { min: v.easyMin! }) };
  },
};

const PRESETS: Record<PlanPresetId, PresetDef> = { '5k-8wk': FIVE_K, 'z2-base-8wk': ZONE2_BASE };

export interface PresetInfo {
  id: PlanPresetId;
  name: string;
  subtitle: string;
  kind: 'race' | 'fitness';
  measure: 'distance' | 'z2_minutes';
  weeks: number;
  daysPerWeek: { min: number; max: number; default: number };
}

export function presetInfo(id: PlanPresetId): PresetInfo {
  const { name, subtitle, kind, measure, weeks, daysPerWeek } = PRESETS[id];
  return { id, name, subtitle, kind, measure, weeks, daysPerWeek };
}

export const PRESET_IDS: readonly PlanPresetId[] = ['5k-8wk', 'z2-base-8wk'];

// ---------------------------------------------------------------------------
// Volume multipliers and ramps

/** Volume multiplier for a 1-based week: cutback 70%, taper 60% then 40%. */
export function weekMultiplier(week: number, weeks: number, cutbackEvery: number | undefined, taperWeeks: number): number {
  const taperStart = weeks - taperWeeks + 1;
  if (taperWeeks > 0 && week >= taperStart) return [0.6, 0.4][week - taperStart] ?? 0.4;
  if (cutbackEvery && week % cutbackEvery === 0) return 0.7;
  return 1;
}

/** Linear ramp from week 1 to peakWeek, held afterwards. */
export function rampValue(ramp: Ramp, week: number, lastBuildWeek: number): number {
  const peakWeek = ramp.peakWeek ?? lastBuildWeek;
  if (peakWeek <= 1) return ramp.peak;
  const t = Math.min(1, Math.max(0, (week - 1) / (peakWeek - 1)));
  return ramp.start + (ramp.peak - ramp.start) * t;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

// ---------------------------------------------------------------------------
// Day assignment

const circular = (a: number, b: number) => {
  const d = Math.abs(a - b) % 7;
  return Math.min(d, 7 - d);
};

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/** Smallest circular gap between any two of the days (7 when fewer than two). */
function minGap(days: readonly number[]): number {
  let best = 7;
  for (let i = 0; i < days.length; i++) for (let j = i + 1; j < days.length; j++) best = Math.min(best, circular(days[i]!, days[j]!));
  return best;
}

/**
 * Assign roles to weekdays (spec §8 step 3): long on the long-run day, quality days
 * spread to maximize the gap from the long run and each other, easy fills the rest.
 * Ties go to the earliest weekday so output is deterministic.
 */
export function assignRoles(roles: readonly PlanRole[], preferredDays: readonly Weekday[], longRunDay: Weekday): Map<Weekday, PlanRole> {
  const count = roles.length;
  const pool = [...new Set(preferredDays)].filter((d) => d !== longRunDay).sort((a, b) => a - b);
  if (pool.length < count - 1) throw new Error(`Need ${count} days but only ${pool.length + 1} available`);

  // Pick training days: maximize the minimum gap between all chosen days.
  let days: Weekday[] = [];
  let bestGap = -1;
  for (const combo of combinations(pool, count - 1)) {
    const gap = minGap([longRunDay, ...combo]);
    if (gap > bestGap) {
      bestGap = gap;
      days = combo;
    }
  }

  const result = new Map<Weekday, PlanRole>([[longRunDay, 'long']]);
  const quality = roles.filter((r) => r === 'quality' || r === 'quality2');
  const easy = roles.filter((r) => r !== 'long' && r !== 'quality' && r !== 'quality2');

  let qualityDays: Weekday[] = [];
  let bestScore = -1;
  for (const combo of combinations(days, quality.length)) {
    const score = minGap([longRunDay, ...combo]);
    if (score > bestScore) {
      bestScore = score;
      qualityDays = combo;
    }
  }
  qualityDays.forEach((d, i) => result.set(d, quality[i]!));
  days.filter((d) => !qualityDays.includes(d)).forEach((d, i) => result.set(d, easy[i]!));
  return result;
}

// ---------------------------------------------------------------------------
// Generation

export interface GeneratedWorkout {
  date: IsoDate;
  /** 1-based plan week. */
  weekIndex: number;
  role: PlanRole;
  hard: boolean;
  workout: Workout;
}

export type PlanWarning =
  | { type: 'back_to_back_hard'; dates: [IsoDate, IsoDate] }
  | { type: 'volume_jump'; week: number; pct: number }
  | { type: 'no_rest_day'; week: number };

export interface GeneratedPlan {
  presetId: PlanPresetId;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  weeks: number;
  /** From the goal time (5K), to store as the current pace profile. */
  vdot?: number;
  workouts: GeneratedWorkout[];
  warnings: PlanWarning[];
}

/** Easy runs by heart rate: easy pace targets become Zone 2. */
function easyToHr(items: WorkoutItem[]): WorkoutItem[] {
  const swap = (s: Step): Step =>
    s.target.type === 'pace_zone' && s.target.zone === 'easy' ? { ...s, target: { type: 'hr_zone', zone: 2 } satisfies Target } : s;
  return items.map((i) => (isRepeat(i) ? { ...i, steps: i.steps.map(swap) } : swap(i)));
}

function modeFor(role: PlanRole, treadmill: PlanInputs['treadmill']): SessionMode {
  if (treadmill === 'mostly') return 'treadmill';
  if (treadmill === 'some' && role.startsWith('easy')) return 'treadmill';
  return 'outdoor';
}

export function generatePlan(inputs: PlanInputs, today: IsoDate, newId: IdGen): GeneratedPlan {
  const preset = PRESETS[inputs.presetId];
  const { min, max } = preset.daysPerWeek;
  if (inputs.daysPerWeek < min || inputs.daysPerWeek > max) {
    throw new Error(`${preset.name} needs ${min}-${max} days per week`);
  }

  // 1. Dates. Weeks run Monday to Sunday.
  let week1: IsoDate;
  let firstDay: IsoDate;
  let lastDay: IsoDate;
  if (preset.kind === 'race') {
    if (!inputs.raceDate) throw new Error('Race plans need a race date');
    week1 = addDays(startOfWeek(inputs.raceDate), -7 * (preset.weeks - 1));
    firstDay = week1 < today ? today : week1;
    lastDay = inputs.raceDate;
  } else {
    const start = inputs.startDate ?? today;
    week1 = startOfWeek(start);
    firstDay = start;
    lastDay = addDays(week1, 7 * preset.weeks - 1);
  }
  if (lastDay < firstDay) throw new Error('Race date has already passed');

  // 2-3. Slots by priority, then weekdays.
  const roles = preset.slots.slice(0, inputs.daysPerWeek);
  const byDay = assignRoles(roles, inputs.preferredDays, inputs.longRunDay);
  const lastBuildWeek = preset.weeks - preset.taperWeeks;

  const workouts: GeneratedWorkout[] = [];
  for (let week = 1; week <= preset.weeks; week++) {
    const mult = weekMultiplier(week, preset.weeks, preset.cutbackEvery, preset.taperWeeks);
    const raw: Record<string, number> = {};
    for (const [key, ramp] of Object.entries(preset.ramps)) raw[key] = rampValue(ramp, week, lastBuildWeek);
    const vars = scaleVars(preset, raw, mult, roles);
    let retestPlaced = !preset.retestWeeks.includes(week);

    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(week1, 7 * (week - 1) + offset);
      if (date < firstDay || date > lastDay) continue;
      let role = byDay.get(weekdayOf(date));
      if (!role) continue;

      let template = preset.session(role, week, vars);
      // 5. Retest replaces the quality slot (or the first non-long slot when there is no quality).
      if (!retestPlaced && (role === 'quality' || (!roles.includes('quality') && role !== 'long'))) {
        template = preset.retest;
        role = 'retest';
        retestPlaced = true;
      }
      workouts.push(build(template, role, date, week, inputs, newId));
    }
  }

  // Race day: replaces anything on the race date and drops the final week's long run.
  if (preset.kind === 'race' && preset.race && inputs.raceDate) {
    const raceDate = inputs.raceDate;
    const finalWeekStart = startOfWeek(raceDate);
    for (let i = workouts.length - 1; i >= 0; i--) {
      const w = workouts[i]!;
      if (w.date === raceDate || addDays(w.date, 1) === raceDate || (w.date >= finalWeekStart && w.role === 'long')) workouts.splice(i, 1);
    }
    workouts.push(build(preset.race, 'race', raceDate, preset.weeks, inputs, newId));
    workouts.sort((a, b) => a.date.localeCompare(b.date));
  }

  const vdot =
    inputs.presetId === '5k-8wk' && inputs.goalSeconds ? Math.round(vdotFromRace(5000, inputs.goalSeconds) * 10) / 10 : undefined;

  const plan: GeneratedPlan = {
    presetId: preset.id,
    name: preset.name,
    startDate: firstDay,
    endDate: lastDay,
    weeks: preset.weeks,
    workouts,
    warnings: [],
  };
  if (vdot !== undefined) plan.vdot = vdot;
  plan.warnings = validatePlan(plan);
  return plan;
}

function scaleVars(preset: PresetDef, raw: Record<string, number>, mult: number, roles: readonly PlanRole[]): Record<string, number> {
  if (preset.measure === 'z2_minutes') {
    const weekMin = raw.weekMin! * mult;
    const longMin = roundTo(raw.longMin! * mult, 5);
    const others = roles.length - 1;
    const easyMin = Math.max(20, roundTo((weekMin - longMin) / Math.max(1, others), 5));
    return { longMin, easyMin };
  }
  return {
    longKm: Math.round(raw.longKm! * mult * 2) / 2,
    easyMin: roundTo(raw.easyMin! * mult, 5),
    reps: Math.max(2, Math.round(raw.reps! * mult)),
    tempoMin: roundTo(raw.tempoMin! * mult, 2),
  };
}

function build(t: SessionTemplate, role: PlanRole, date: IsoDate, weekIndex: number, inputs: PlanInputs, newId: IdGen): GeneratedWorkout {
  let items = parseWorkout(t.dsl, newId);
  if (inputs.easyBy === 'hr') items = easyToHr(items);
  return {
    date,
    weekIndex,
    role,
    hard: isHardRole(role),
    workout: { id: newId(), name: t.name, kind: 'run', items, defaultMode: modeFor(role, inputs.treadmill) },
  };
}

// ---------------------------------------------------------------------------
// Validation (spec §8 scheduling rules). Soft: warnings for the preview, never errors.

/** Minutes of Zone 2 work (hr_zone 2 steps) in a workout. */
export function z2Minutes(items: readonly WorkoutItem[]): number {
  return flattenSteps(items)
    .filter((s) => s.target.type === 'hr_zone' && s.target.zone === 2)
    .reduce((sum, s) => sum + stepSeconds(s) / 60, 0);
}

export function weeklyVolume(plan: Pick<GeneratedPlan, 'presetId' | 'workouts'>, week: number, pace?: PaceLookup): number {
  const measure = PRESETS[plan.presetId].measure;
  return plan.workouts
    .filter((w) => w.weekIndex === week)
    .reduce((sum, w) => sum + (measure === 'z2_minutes' ? z2Minutes(w.workout.items) : totalMeters(w.workout.items, pace)), 0);
}

export function validatePlan(plan: Pick<GeneratedPlan, 'presetId' | 'workouts' | 'weeks'>): PlanWarning[] {
  const preset = PRESETS[plan.presetId];
  const warnings: PlanWarning[] = [];

  const hard = plan.workouts.filter((w) => w.hard).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < hard.length; i++) {
    const a = hard[i - 1]!;
    const b = hard[i]!;
    if (diffDays(a.date, b.date) <= 1) warnings.push({ type: 'back_to_back_hard', dates: [a.date, b.date] });
  }

  const perWeek = (week: number) => plan.workouts.filter((w) => w.weekIndex === week);
  const fullWeek = Math.max(0, ...Array.from({ length: plan.weeks }, (_, i) => perWeek(i + 1).length));

  let prevBuild: number | undefined;
  for (let week = 1; week <= plan.weeks; week++) {
    const inWeek = perWeek(week);
    const days = new Set(inWeek.map((w) => w.date));
    if (days.size >= 7) warnings.push({ type: 'no_rest_day', week });

    // Volume only compares full build weeks (not cutback, taper, or a partial first week).
    const mult = weekMultiplier(week, plan.weeks, preset.cutbackEvery, preset.taperWeeks);
    if (mult < 1 || inWeek.length < fullWeek) continue;
    const volume = weeklyVolume(plan, week);
    if (prevBuild !== undefined && prevBuild > 0) {
      const pct = Math.round(((volume - prevBuild) / prevBuild) * 100);
      if (pct > 10) warnings.push({ type: 'volume_jump', week, pct });
    }
    prevBuild = volume;
  }
  return warnings;
}
