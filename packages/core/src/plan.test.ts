import { describe, expect, it } from 'vitest';
import { weekdayOf } from './dates';
import { counterIds } from './dsl';
import { assignRoles, generatePlan, weeklyVolume } from './plan';
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
