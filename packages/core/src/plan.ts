import type { PlanRole } from './agenda';
import { addDays, diffDays, startOfWeek, weekdayOf, type IsoDate, type Weekday } from './dates';
import { parseWorkout, renderTemplate, type IdGen } from './dsl';
import { isHardWorkout } from './moving';
import type { PlanInputs, PlanPresetId, StartingFitness } from './repository';
import { vdotFromRace, zonePace } from './vdot';
import type { PaceZone, SessionMode, Step, Target, Workout, WorkoutItem } from './workout';
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
  /** Race distance, so a goal time can set paces. */
  raceMeters?: number;
  measure: 'distance' | 'z2_minutes';
  weeks: number;
  /** Fitness plans with a choice of length (spec §8 "start date + plan length"). */
  weeksOptions?: number[];
  daysPerWeek: { min: number; max: number; default: number };
  cutbackEvery?: number;
  taperWeeks: number;
  retestWeeks: number[];
  retest?: SessionTemplate;
  /** Roles by priority; the first `daysPerWeek` survive. */
  slots: PlanRole[];
  /** Values ramped from start to peak across build weeks. */
  ramps: Record<string, Ramp>;
  /** Round the ramped values for a week, after the cutback or taper multiplier. */
  vars(raw: Record<string, number>, mult: number, roles: readonly PlanRole[]): Record<string, number>;
  /** Build the session for a role in a week from the ramped values. */
  session(role: PlanRole, week: number, vars: Record<string, number>): SessionTemplate;
  race?: SessionTemplate;
  /**
   * Ramp start values from current fitness. Each is clamped to [floor, 85% of peak],
   * so a fit runner starts higher but the plan still builds.
   */
  startFrom?(f: FitnessMinutes): Record<string, { value: number; floor: number }>;
}

/** Starting fitness converted to running minutes at an easy pace. */
interface FitnessMinutes {
  longestRunM: number;
  longestRunMin: number;
  weeklyMin: number;
  perRunMin?: number;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Race plans: long run in km, easy minutes, rep counts and tempo minutes. */
function raceVars(raw: Record<string, number>, mult: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const x = v * mult;
    out[k] = k.endsWith('Km') ? Math.round(x * 2) / 2 : k === 'reps' ? Math.max(2, Math.round(x)) : k.endsWith('Min') ? roundTo(x, k === 'tempoMin' ? 2 : 5) : Math.round(x);
  }
  return out;
}

/** Zone 2 plans: weekly Zone 2 minutes split into one long session and equal easy sessions. */
function z2Vars(raw: Record<string, number>, mult: number, roles: readonly PlanRole[]): Record<string, number> {
  const weekMin = raw.weekMin! * mult;
  const longMin = roundTo(raw.longMin! * mult, 5);
  const easy = roles.filter((r) => r.startsWith('easy')).length;
  const easyMin = Math.max(20, roundTo((weekMin - longMin) / Math.max(1, easy), 5));
  const out: Record<string, number> = { longMin, easyMin };
  if (raw.reps !== undefined) out.reps = Math.max(3, Math.round(raw.reps * mult));
  return out;
}

/** Time-based plans: every ramped value is minutes (or reps), scaled and rounded. */
function minuteVars(raw: Record<string, number>, mult: number): Record<string, number> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, k === 'reps' ? Math.max(2, Math.round(v * mult)) : roundTo(v * mult, 5)]));
}

const FIVE_K: PresetDef = {
  id: '5k-8wk',
  name: '5K',
  subtitle: '8 weeks, intervals, tempo and long runs',
  kind: 'race',
  raceMeters: 5000,
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
  vars: raceVars,
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
  startFrom: (f) => {
    const out: Record<string, { value: number; floor: number }> = { longKm: { value: (f.longestRunM / 1000) * 0.9, floor: 3 } };
    if (f.perRunMin !== undefined) out.easyMin = { value: f.perRunMin, floor: 20 };
    return out;
  },
};

const TEN_K: PresetDef = {
  id: '10k-10wk',
  name: '10K',
  subtitle: '10 weeks, threshold focus',
  kind: 'race',
  raceMeters: 10000,
  measure: 'distance',
  weeks: 10,
  daysPerWeek: { min: 3, max: 5, default: 4 },
  cutbackEvery: 4,
  taperWeeks: 1,
  retestWeeks: [5],
  retest: { name: '5K time trial', dsl: 'Warm up: 10m easy, 3km @ RPE 9, Cool down: 10m easy' },
  slots: ['long', 'quality', 'easy', 'quality2', 'easy2'],
  ramps: {
    longKm: { start: 8, peak: 15, peakWeek: 8 },
    easyMin: { start: 30, peak: 45, peakWeek: 8 },
    cruiseReps: { start: 3, peak: 5, peakWeek: 8 },
    tempoMin: { start: 15, peak: 30, peakWeek: 8 },
    reps: { start: 4, peak: 6, peakWeek: 8 },
  },
  vars: raceVars,
  session(role, week, v) {
    switch (role) {
      case 'long':
        return { name: 'Long run', dsl: `${v.longKm}km easy` };
      case 'quality':
        return week % 2 === 1
          ? { name: 'Cruise intervals', dsl: `Warm up: 15m easy, ${v.cruiseReps}x [ 1km @ threshold, 60s walk ], Cool down: 10m easy` }
          : { name: 'Tempo run', dsl: `Warm up: 10m easy, ${v.tempoMin}min @ tempo, Cool down: 10m easy` };
      case 'quality2':
        return { name: 'Intervals', dsl: `Warm up: 15m easy, ${v.reps}x [ 800m @ interval, 2min walk ], Cool down: 10m easy` };
      default:
        return { name: 'Easy run', dsl: `${v.easyMin}min easy` };
    }
  },
  race: { name: '10K race', dsl: 'Warm up: 10m easy, 10km @ RPE 9' },
  startFrom: (f) => {
    const out: Record<string, { value: number; floor: number }> = { longKm: { value: (f.longestRunM / 1000) * 0.9, floor: 5 } };
    if (f.perRunMin !== undefined) out.easyMin = { value: f.perRunMin, floor: 25 };
    return out;
  },
};

const HALF: PresetDef = {
  id: 'half-12wk',
  name: 'Half Marathon',
  subtitle: '12 weeks, long run progression',
  kind: 'race',
  raceMeters: 21097.5,
  measure: 'distance',
  weeks: 12,
  daysPerWeek: { min: 3, max: 5, default: 4 },
  cutbackEvery: 4,
  taperWeeks: 2,
  retestWeeks: [6],
  retest: { name: '5K time trial', dsl: 'Warm up: 10m easy, 3km @ RPE 9, Cool down: 10m easy' },
  slots: ['long', 'quality', 'easy', 'quality2', 'easy2'],
  ramps: {
    longKm: { start: 8, peak: 19, peakWeek: 10 },
    easyMin: { start: 30, peak: 50, peakWeek: 10 },
    tempoMin: { start: 15, peak: 30, peakWeek: 10 },
    reps: { start: 4, peak: 8, peakWeek: 10 },
  },
  vars: raceVars,
  session(role, week, v) {
    switch (role) {
      case 'long':
        return { name: 'Long run', dsl: `${v.longKm}km easy` };
      case 'quality': {
        // Rotation from the spec's preset example: tempo, intervals, hills.
        const r = (week - 1) % 3;
        if (r === 0) return { name: 'Tempo run', dsl: `Warm up: 10m easy, ${v.tempoMin}min @ tempo, Cool down: 10m easy` };
        if (r === 1) return { name: 'Intervals', dsl: `Warm up: 15m easy, ${v.reps}x [ 800m @ interval, 2min walk ], Cool down: 10m easy` };
        return { name: 'Hills', dsl: `Warm up: 15m easy, ${v.reps}x [ 60s @ RPE 8, 90s walk ], Cool down: 10m easy` };
      }
      case 'quality2':
        return { name: 'Steady run', dsl: `Warm up: 10m easy, ${v.tempoMin}min @ steady, Cool down: 5m easy` };
      default:
        return { name: 'Easy run', dsl: `${v.easyMin}min easy` };
    }
  },
  race: { name: 'Half marathon race', dsl: 'Warm up: 10m easy, 21.1km @ RPE 8' },
  startFrom: (f) => {
    const out: Record<string, { value: number; floor: number }> = { longKm: { value: (f.longestRunM / 1000) * 0.9, floor: 6 } };
    if (f.perRunMin !== undefined) out.easyMin = { value: f.perRunMin, floor: 25 };
    return out;
  },
};

/** Run/walk weeks for Couch to 5K: effort based, 5 minute walk warm-up and cool-down. */
const C25K_WEEKS = [
  '8x [ 60s run @ RPE 5, 90s walk ]',
  '6x [ 90s run @ RPE 5, 2min walk ]',
  '4x [ 3min run @ RPE 5, 90s walk ]',
  '3x [ 5min run @ RPE 5, 2:30 walk ]',
  '3x [ 8min run @ RPE 5, 3min walk ]',
  '2x [ 10min run @ RPE 5, 3min walk ]',
  '25min run @ RPE 5',
  '28min run @ RPE 5',
  '30min run @ RPE 5',
];

const COUCH_TO_5K: PresetDef = {
  id: 'c25k-9wk',
  name: 'Couch to 5K',
  subtitle: '9 weeks of run/walk to 30 minutes running',
  kind: 'fitness',
  measure: 'distance',
  weeks: 9,
  daysPerWeek: { min: 3, max: 3, default: 3 },
  taperWeeks: 0,
  retestWeeks: [],
  slots: ['long', 'easy', 'easy2'],
  ramps: {},
  vars: () => ({}),
  session: (_role, week) => ({ name: `Run/walk, week ${week}`, dsl: `Warm up: 5min walk, ${C25K_WEEKS[week - 1]}, Cool down: 5min walk` }),
};

const WALK_TO_RUN_WEEKS = [
  '30min walk @ RPE 4',
  '6x [ 30s run @ RPE 4, 4min walk ]',
  '8x [ 30s run @ RPE 4, 2min walk ]',
  '8x [ 45s run @ RPE 4, 2min walk ]',
  '6x [ 60s run @ RPE 5, 2min walk ]',
  '8x [ 60s run @ RPE 5, 90s walk ]',
];

const WALK_TO_RUN: PresetDef = {
  id: 'walk-to-run-6wk',
  name: 'Walk to Run',
  subtitle: '6 weeks of walking with short jogs, before Couch to 5K',
  kind: 'fitness',
  measure: 'distance',
  weeks: 6,
  daysPerWeek: { min: 3, max: 4, default: 3 },
  taperWeeks: 0,
  retestWeeks: [],
  slots: ['long', 'easy', 'easy2', 'easy3'],
  ramps: {},
  vars: () => ({}),
  session: (_role, week) => ({ name: week === 1 ? 'Brisk walk' : `Walk and jog, week ${week}`, dsl: `Warm up: 5min walk, ${WALK_TO_RUN_WEEKS[week - 1]}, Cool down: 5min walk` }),
};

const BASE_BUILDER: PresetDef = {
  id: 'base-builder',
  name: 'Base Builder',
  subtitle: 'Mostly easy running with strides, in 4 week cycles',
  kind: 'fitness',
  measure: 'distance',
  weeks: 8,
  weeksOptions: [4, 8, 12],
  daysPerWeek: { min: 3, max: 5, default: 4 },
  cutbackEvery: 4,
  taperWeeks: 0,
  retestWeeks: [],
  slots: ['long', 'easy', 'easy2', 'easy3', 'easy4'],
  ramps: { easyMin: { start: 25, peak: 45 }, longMin: { start: 40, peak: 75 } },
  vars: minuteVars,
  session(role, _week, v) {
    if (role === 'long') return { name: 'Long easy run', dsl: `${v.longMin}min easy` };
    if (role === 'easy') return { name: 'Easy run with strides', dsl: `${v.easyMin}min easy, 6x [ 20s run @ RPE 7, 60s walk ]` };
    return { name: 'Easy run', dsl: `${v.easyMin}min easy` };
  },
  startFrom: (f) => {
    const out: Record<string, { value: number; floor: number }> = { longMin: { value: f.longestRunMin, floor: 30 } };
    if (f.perRunMin !== undefined) out.easyMin = { value: f.perRunMin, floor: 20 };
    return out;
  },
};

const SPEED_BLOCK: PresetDef = {
  id: 'speed-6wk',
  name: 'Speed Block',
  subtitle: '6 weeks of sprints and hills with lots of walk recovery',
  kind: 'fitness',
  measure: 'distance',
  weeks: 6,
  daysPerWeek: { min: 3, max: 4, default: 3 },
  cutbackEvery: 3,
  taperWeeks: 0,
  retestWeeks: [],
  slots: ['quality', 'easy', 'quality2', 'long'],
  ramps: { reps: { start: 6, peak: 10 }, hillReps: { start: 4, peak: 8 }, easyMin: { start: 25, peak: 35 }, longMin: { start: 35, peak: 50 } },
  vars: (raw, mult) => ({ ...minuteVars(raw, mult), hillReps: Math.max(3, Math.round(raw.hillReps! * mult)) }),
  session(role, _week, v) {
    switch (role) {
      case 'quality':
        return { name: 'Sprints', dsl: `Warm up: 10m easy, ${v.reps}x [ 20s sprint @ RPE 9, 100s walk ], Cool down: 10m easy` };
      case 'quality2':
        return { name: 'Hill sprints', dsl: `Warm up: 10m easy, ${v.hillReps}x [ 45s @ RPE 8, 2min walk ], Cool down: 10m easy` };
      case 'long':
        return { name: 'Long easy run', dsl: `${v.longMin}min easy` };
      default:
        return { name: 'Easy run', dsl: `${v.easyMin}min easy` };
    }
  },
};

const Z2_SESSION = 'Warm up: 5m walk, {{min}}min @ Z2, Cool down: 5m walk';
const AEROBIC_TEST: SessionTemplate = { name: 'Aerobic test', dsl: 'Warm up: 5m walk, 30min @ Z2, Cool down: 5m walk' };

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
  retest: AEROBIC_TEST,
  slots: ['long', 'easy', 'easy2', 'easy3', 'easy4'],
  ramps: {
    weekMin: { start: 90, peak: 200, peakWeek: 7 },
    longMin: { start: 45, peak: 75, peakWeek: 7 },
  },
  vars: z2Vars,
  session(role, _week, v) {
    if (role === 'long') return { name: 'Zone 2 Long', dsl: renderTemplate(Z2_SESSION, { min: v.longMin! }) };
    return { name: 'Zone 2 Run', dsl: renderTemplate(Z2_SESSION, { min: v.easyMin! }) };
  },
  startFrom: (f) => ({
    weekMin: { value: f.weeklyMin, floor: 60 },
    longMin: { value: f.longestRunMin, floor: 30 },
  }),
};

const ZONE2_RUN_WALK: PresetDef = {
  id: 'z2-run-walk-6wk',
  name: 'Zone 2 Run/Walk Start',
  subtitle: 'Run/walk in Zone 2 for when steady running drifts too high',
  kind: 'fitness',
  measure: 'z2_minutes',
  weeks: 6,
  daysPerWeek: { min: 3, max: 4, default: 3 },
  taperWeeks: 0,
  retestWeeks: [6],
  retest: AEROBIC_TEST,
  slots: ['long', 'easy', 'easy2', 'easy3'],
  ramps: { sessionMin: { start: 25, peak: 45, peakWeek: 5 } },
  vars: minuteVars,
  session(role, _week, v) {
    const total = v.sessionMin! + (role === 'long' ? 10 : 0);
    // Blocks of 4 minutes running and 1 minute walking, both held in Zone 2.
    return { name: role === 'long' ? 'Zone 2 Run/Walk Long' : 'Zone 2 Run/Walk', dsl: `Warm up: 5m walk, ${Math.max(3, Math.round(total / 5))}x [ 4min run @ Z2, 1min walk @ Z2 ], Cool down: 5m walk` };
  },
};

const ZONE2_WALK: PresetDef = {
  id: 'z2-walk-4wk',
  name: 'Zone 2 Walk',
  subtitle: 'Brisk or incline walking, treadmill friendly',
  kind: 'fitness',
  measure: 'z2_minutes',
  weeks: 4,
  weeksOptions: [4, 8, 12],
  daysPerWeek: { min: 3, max: 5, default: 4 },
  taperWeeks: 0,
  retestWeeks: [],
  slots: ['long', 'easy', 'easy2', 'easy3', 'easy4'],
  ramps: { sessionMin: { start: 30, peak: 50 }, longMin: { start: 40, peak: 60 } },
  vars: minuteVars,
  session(role, _week, v) {
    const min = role === 'long' ? v.longMin! : v.sessionMin!;
    return { name: role === 'long' ? 'Zone 2 Long walk' : 'Zone 2 Walk', dsl: `${min}min walk @ Z2` };
  },
};

const ZONE2_SPEED: PresetDef = {
  ...ZONE2_BASE,
  id: 'z2-speed-8wk',
  name: 'Zone 2 + Speed',
  subtitle: 'About 80% Zone 2 with one short speed session a week',
  slots: ['long', 'easy', 'easy2', 'easy3', 'easy4'],
  ramps: { ...ZONE2_BASE.ramps, reps: { start: 6, peak: 10, peakWeek: 7 } },
  session(role, week, v) {
    if (role === 'quality') {
      return week % 2 === 1
        ? { name: 'Sprints', dsl: `Warm up: 10m easy, ${v.reps}x [ 20s sprint @ RPE 9, 100s walk ], Cool down: 10m easy` }
        : { name: 'Short intervals', dsl: `Warm up: 10m easy, ${Math.max(4, Math.round(v.reps! * 0.6))}x [ 400m @ interval, 90s walk ], Cool down: 10m easy` };
    }
    return ZONE2_BASE.session(role, week, v);
  },
};

const PRESETS: Record<PlanPresetId, PresetDef> = {
  '5k-8wk': FIVE_K,
  '10k-10wk': TEN_K,
  'half-12wk': HALF,
  'c25k-9wk': COUCH_TO_5K,
  'walk-to-run-6wk': WALK_TO_RUN,
  'base-builder': BASE_BUILDER,
  'speed-6wk': SPEED_BLOCK,
  'z2-base-8wk': ZONE2_BASE,
  'z2-run-walk-6wk': ZONE2_RUN_WALK,
  'z2-walk-4wk': ZONE2_WALK,
  'z2-speed-8wk': ZONE2_SPEED,
};

export interface PresetInfo {
  id: PlanPresetId;
  name: string;
  subtitle: string;
  kind: 'race' | 'fitness';
  measure: 'distance' | 'z2_minutes';
  weeks: number;
  daysPerWeek: { min: number; max: number; default: number };
  /** Lengths to offer for fitness plans; absent means fixed. */
  weeksOptions?: number[];
  /** Race plans: the race distance, for the goal time. */
  raceMeters?: number;
  /** Run/walk plans for beginners, effort based (no pace profile needed). */
  beginner: boolean;
}

export function presetInfo(id: PlanPresetId): PresetInfo {
  const { name, subtitle, kind, measure, weeks, daysPerWeek, weeksOptions, raceMeters } = PRESETS[id];
  const info: PresetInfo = { id, name, subtitle, kind, measure, weeks, daysPerWeek, beginner: id === 'c25k-9wk' || id === 'walk-to-run-6wk' };
  if (weeksOptions) info.weeksOptions = weeksOptions;
  if (raceMeters) info.raceMeters = raceMeters;
  return info;
}

/** Wizard order: race plans, beginner plans, fitness plans, then Zone 2. */
export const PRESET_IDS: readonly PlanPresetId[] = [
  '5k-8wk',
  '10k-10wk',
  'half-12wk',
  'walk-to-run-6wk',
  'c25k-9wk',
  'base-builder',
  'speed-6wk',
  'z2-base-8wk',
  'z2-run-walk-6wk',
  'z2-walk-4wk',
  'z2-speed-8wk',
];

/**
 * Wizard hint for "Can you run 20 minutes without stopping?" (spec §6 beginner
 * fallback): No points to the run/walk plans, which need no pace profile.
 */
export function suggestedPresets(canRun20Min: boolean): PlanPresetId[] {
  return canRun20Min ? ['5k-8wk', '10k-10wk', 'base-builder', 'z2-base-8wk'] : ['walk-to-run-6wk', 'c25k-9wk', 'z2-run-walk-6wk', 'z2-walk-4wk'];
}

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
 * Spread score, compared lexicographically: the smallest gap first, then fewer
 * back-to-back pairs. With 4 or more days in a week some days must touch, and the
 * smallest gap alone would tie every choice (packing Monday to Wednesday).
 */
function spread(days: readonly number[]): [number, number] {
  let adjacent = 0;
  for (let i = 0; i < days.length; i++) for (let j = i + 1; j < days.length; j++) if (circular(days[i]!, days[j]!) === 1) adjacent++;
  return [minGap(days), -adjacent];
}

const better = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

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
  let bestSpread: [number, number] = [-1, -Infinity];
  for (const combo of combinations(pool, count - 1)) {
    const s = spread([longRunDay, ...combo]);
    if (better(s, bestSpread)) {
      bestSpread = s;
      days = combo;
    }
  }

  const result = new Map<Weekday, PlanRole>([[longRunDay, 'long']]);
  const quality = roles.filter((r) => r === 'quality' || r === 'quality2');
  const easy = roles.filter((r) => r !== 'long' && r !== 'quality' && r !== 'quality2');

  let qualityDays: Weekday[] = [];
  let bestScore: [number, number] = [-1, -Infinity];
  for (const combo of combinations(days, quality.length)) {
    const score = spread([longRunDay, ...combo]);
    if (better(score, bestScore)) {
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

/** Effort for each pace zone, for beginners without a pace profile (spec §6 fallback). */
const ZONE_RPE: Record<PaceZone, number> = { easy: 4, steady: 5, tempo: 6, threshold: 7, interval: 8, repetition: 9 };

/** Beginner pace source: pace targets become effort until a time trial sets paces. */
function paceToEffort(items: WorkoutItem[]): WorkoutItem[] {
  const swap = (s: Step): Step => (s.target.type === 'pace_zone' ? { ...s, target: { type: 'effort', rpe: ZONE_RPE[s.target.zone] } satisfies Target } : s);
  return items.map((i) => (isRepeat(i) ? { ...i, steps: i.steps.map(swap) } : swap(i)));
}

const TIME_TRIAL: SessionTemplate = { name: '3 km time trial', dsl: 'Warm up: 10m easy, Time trial: 3km run @ RPE 9, Cool down: 10m easy' };

function modeFor(role: PlanRole, treadmill: PlanInputs['treadmill']): SessionMode {
  if (treadmill === 'mostly') return 'treadmill';
  if (treadmill === 'some' && role.startsWith('easy')) return 'treadmill';
  return 'outdoor';
}

export function generatePlan(inputs: PlanInputs, today: IsoDate, newId: IdGen): GeneratedPlan {
  const base = PRESETS[inputs.presetId];
  if (inputs.weeks !== undefined && !base.weeksOptions?.includes(inputs.weeks)) throw new Error(`${base.name} does not come in ${inputs.weeks} weeks`);
  const preset: PresetDef = inputs.weeks !== undefined ? { ...base, weeks: inputs.weeks } : base;
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
  const vdot = planVdot(inputs);
  const ramps = startingRamps(preset, inputs.fitness, vdot);

  const workouts: GeneratedWorkout[] = [];
  for (let week = 1; week <= preset.weeks; week++) {
    const mult = weekMultiplier(week, preset.weeks, preset.cutbackEvery, preset.taperWeeks);
    const raw: Record<string, number> = {};
    for (const [key, ramp] of Object.entries(ramps)) raw[key] = rampValue(ramp, week, lastBuildWeek);
    const vars = preset.vars(raw, mult, roles);
    // "Time trial" pace source: a trial in week 1 sets paces before the first quality session.
    const trialWeek = inputs.paceSource === 'trial' && week === 1;
    const retest = trialWeek ? TIME_TRIAL : preset.retest;
    let retestPlaced = !retest || !(trialWeek || preset.retestWeeks.includes(week));

    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(week1, 7 * (week - 1) + offset);
      if (date < firstDay || date > lastDay) continue;
      let role = byDay.get(weekdayOf(date));
      if (!role) continue;

      let template = preset.session(role, week, vars);
      // 5. Retest replaces the quality slot (or the first non-long slot when there is no quality).
      if (!retestPlaced && retest && (role === 'quality' || (!roles.includes('quality') && role !== 'long'))) {
        template = retest;
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

/**
 * Training paces come from current fitness (a recent race) when given, otherwise the
 * 5K goal time. Daniels trains at current fitness; the goal is the target, not the pace.
 */
function planVdot(inputs: PlanInputs): number | undefined {
  const race = inputs.fitness?.recentRace;
  if (race) return Math.round(vdotFromRace(race.meters, race.seconds) * 10) / 10;
  const meters = PRESETS[inputs.presetId].raceMeters;
  if (meters && inputs.goalSeconds) return Math.round(vdotFromRace(meters, inputs.goalSeconds) * 10) / 10;
  return undefined;
}

/** Easy pace when nothing is known: 7:00 /km (about 11:15 /mi). */
const DEFAULT_EASY_SEC_PER_KM = 420;

function startingRamps(preset: PresetDef, fitness: StartingFitness | undefined, vdot: number | undefined): Record<string, Ramp> {
  if (!fitness || !preset.startFrom) return preset.ramps;
  const { runsPerWeek, weeklyDistanceM, longestRunM } = fitness;
  if (![runsPerWeek, weeklyDistanceM, longestRunM].every((v) => Number.isFinite(v) && v >= 0)) {
    throw new Error('Starting fitness values must be zero or more');
  }
  const easy = vdot !== undefined ? zonePace(vdot, 'easy').targetSecPerKm : DEFAULT_EASY_SEC_PER_KM;
  const minutes = (m: number) => ((m / 1000) * easy) / 60;
  const f: FitnessMinutes = { longestRunM, longestRunMin: minutes(longestRunM), weeklyMin: minutes(weeklyDistanceM) };
  if (runsPerWeek > 0) f.perRunMin = minutes(weeklyDistanceM) / runsPerWeek;

  const ramps = { ...preset.ramps };
  for (const [key, { value, floor }] of Object.entries(preset.startFrom(f))) {
    const ramp = ramps[key];
    if (!ramp) continue;
    ramps[key] = { ...ramp, start: Math.min(Math.max(value, floor), ramp.peak * 0.85) };
  }
  return ramps;
}

function build(t: SessionTemplate, role: PlanRole, date: IsoDate, weekIndex: number, inputs: PlanInputs, newId: IdGen): GeneratedWorkout {
  let items = parseWorkout(t.dsl, newId);
  if (inputs.paceSource === 'beginner') items = paceToEffort(items);
  else if (inputs.easyBy === 'hr') items = easyToHr(items);
  return {
    date,
    weekIndex,
    role,
    hard: isHardWorkout(role, items),
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
