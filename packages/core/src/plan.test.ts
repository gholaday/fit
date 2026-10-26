import { describe, expect, it } from 'vitest';
import { weekdayOf } from './dates';
import { counterIds } from './dsl';
import { assignRoles, generatePlan, PRESET_IDS, presetInfo, weeklyVolume } from './plan';
import { flattenSteps } from './workout';
import type { PlanInputs } from './repository';

const TODAY = '2026-10-26'; // Monday

const fiveK: PlanInputs = {
  presetId: '5k-8wk',
  raceDate: '2026-12-20', // Sunday, 8 weeks out
  daysPerWeek: 4,
  preferredDays: [2, 4, 6, 7],
  longRunDay: 7,
  goalSeconds: 25 * 60,
  easyBy: 'pace',
  treadmill: 'none',
};

const zone2: PlanInputs = {
  presetId: 'z2-base-8wk',
  startDate: TODAY,
  daysPerWeek: 4,
  preferredDays: [2, 4, 5, 7],
  longRunDay: 7,
  easyBy: 'hr',
  treadmill: 'none',
};

describe('assignRoles', () => {
  it('spreads quality days away from the long run and each other', () => {
    const roles = assignRoles(['long', 'quality', 'easy', 'quality2'], [2, 4, 6, 7], 7);
    expect(Object.fromEntries(roles)).toEqual({ 7: 'long', 2: 'quality', 4: 'quality2', 6: 'easy' });
  });
});

describe('generatePlan: 5K', () => {
  const plan = generatePlan(fiveK, TODAY, counterIds());
  const inWeek = (w: number) => plan.workouts.filter((x) => x.weekIndex === w);

  it('ends with the race on race day and no long run that week', () => {
    const last = plan.workouts.at(-1)!;
    expect(last).toMatchObject({ date: '2026-12-20', role: 'race' });
    expect(inWeek(8).some((w) => w.role === 'long')).toBe(false);
  });

  it('cuts back week 4 and puts the retest in place of the quality run', () => {
    const longKm = (w: number) => inWeek(w).find((x) => x.role === 'long')!.workout.items;
    expect(weeklyVolume(plan, 4)).toBeLessThan(weeklyVolume(plan, 3));
    expect(longKm(4)).not.toEqual(longKm(3));
    expect(inWeek(4).map((w) => w.role)).toContain('retest');
    expect(inWeek(4).map((w) => w.role)).not.toContain('quality');
  });

  it('has no back-to-back hard days and derives VDOT from the goal time', () => {
    expect(plan.warnings.filter((w) => w.type === 'back_to_back_hard')).toEqual([]);
    expect(plan.vdot).toBeCloseTo(38.3, 0);
  });
});

describe('generatePlan: Zone 2 Base', () => {
  const plan = generatePlan(zone2, TODAY, counterIds());

  it('builds Zone 2 minutes toward peak with a week 4 cutback', () => {
    const v = (w: number) => weeklyVolume(plan, w);
    expect(v(1)).toBeGreaterThanOrEqual(90);
    expect(v(7)).toBeGreaterThan(v(3));
    expect(v(4)).toBeLessThan(v(3));
  });

  it('places aerobic tests in weeks 1, 4 and 8', () => {
    const weeks = plan.workouts.filter((w) => w.role === 'retest').map((w) => w.weekIndex);
    expect(weeks).toEqual([1, 4, 8]);
  });

  it('skips days before the start date', () => {
    const late = generatePlan({ ...zone2, startDate: '2026-10-29' }, TODAY, counterIds());
    expect(late.workouts[0]!.date >= '2026-10-29').toBe(true);
    expect(weekdayOf(late.workouts[0]!.date)).toBeGreaterThanOrEqual(4);
  });
});

describe('generatePlan: starting fitness', () => {
  const longRunKm = (inputs: PlanInputs) => {
    const plan = generatePlan(inputs, TODAY, counterIds());
    const long = plan.workouts.find((w) => w.weekIndex === 1 && w.role === 'long')!;
    return (long.workout.items[0] as { duration: { meters: number } }).duration.meters / 1000;
  };

  it('starts the long run from your longest run, clamped to a floor and below peak', () => {
    const at = (longestRunM: number) => longRunKm({ ...fiveK, fitness: { runsPerWeek: 3, weeklyDistanceM: 20_000, longestRunM } });
    expect(at(0)).toBe(3); // beginner floor
    expect(at(8000)).toBe(7); // 90% of 8 km, rounded to 0.5
    expect(at(30_000)).toBe(8.5); // capped at 85% of the 10 km peak
  });

  it('scales Zone 2 minutes from weekly running and takes paces from a recent race over the goal', () => {
    const z2Week1 = (weeklyDistanceM: number) =>
      weeklyVolume(generatePlan({ ...zone2, fitness: { runsPerWeek: 4, weeklyDistanceM, longestRunM: 8000 } }, TODAY, counterIds()), 1);
    expect(z2Week1(25_000)).toBeGreaterThan(z2Week1(5000));

    const recent = generatePlan({ ...fiveK, fitness: { runsPerWeek: 3, weeklyDistanceM: 20_000, longestRunM: 8000, recentRace: { meters: 5000, seconds: 1200 } } }, TODAY, counterIds());
    expect(recent.vdot).toBeCloseTo(49.8, 0); // 20:00 5K, not the 25:00 goal
  });
});

describe('every preset', () => {
  it.each(PRESET_IDS.map((id) => [id]))('%s generates a valid plan at its default days', (id) => {
    const info = presetInfo(id);
    const inputs: PlanInputs = {
      presetId: id,
      daysPerWeek: info.daysPerWeek.default,
      preferredDays: [1, 2, 3, 4, 5, 6, 7],
      longRunDay: 7,
      easyBy: 'pace',
      treadmill: 'none',
      ...(info.kind === 'race' ? { raceDate: '2027-03-21', goalSeconds: 3600 } : { startDate: TODAY }),
    };
    const plan = generatePlan(inputs, TODAY, counterIds());
    expect(plan.workouts.length).toBeGreaterThanOrEqual(info.weeks * info.daysPerWeek.default - 2);
    expect(plan.warnings.filter((w) => w.type !== 'volume_jump')).toEqual([]);
  });

  it('beginner pace source uses effort, and the trial source opens with a time trial', () => {
    const beginner = generatePlan({ ...fiveK, paceSource: 'beginner' }, TODAY, counterIds());
    const targets = beginner.workouts.flatMap((w) => flattenSteps(w.workout.items).map((s) => s.target.type));
    expect(targets).not.toContain('pace_zone');
    const trial = generatePlan({ ...zone2, presetId: 'base-builder', paceSource: 'trial', weeks: 4 }, TODAY, counterIds());
    expect(trial.weeks).toBe(4);
    expect(trial.workouts.filter((w) => w.role === 'retest').map((w) => [w.weekIndex, w.workout.name])).toEqual([[1, '3 km time trial']]);
  });
});
