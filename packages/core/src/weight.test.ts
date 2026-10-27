import { describe, expect, it } from 'vitest';
import { allowedPaces, expectedGoalDate, goalProgress, weightRate, weightTrend, type WeightGoal } from './weight';

const w = (date: string, kg: number, time = '07:00') => ({ date, measuredAt: `${date}T${time}:00.000Z`, kg });
const r1 = (n: number) => Math.round(n * 10) / 10;

describe('weightTrend', () => {
  it('starts at the first weigh-in, uses the first of each day, and moves by 1 - e^(-gap/7)', () => {
    const points = weightTrend([w('2026-10-02', 90, '19:00'), w('2026-10-01', 90), w('2026-10-02', 89), w('2026-10-08', 88)]);
    expect(points.map((p) => [p.date, r1(p.kg), p.weighInKg])).toEqual([
      ['2026-10-01', 90, 90],
      ['2026-10-02', 89.9, 89],
      // Six days gap pulls most of the way: 89.87 + (88 - 89.87) * (1 - e^(-6/7)).
      ['2026-10-08', 88.8, 88],
    ]);
  });
});

describe('weightRate', () => {
  const steady = Array.from({ length: 15 }, (_, i) => w(`2026-10-${String(i + 1).padStart(2, '0')}`, 90 - i * 0.1));
  it.each([
    ['needs two days at least 7 apart', [w('2026-10-10', 90), w('2026-10-14', 89)], undefined],
    ['a steady 0.1 kg a day loss reads 0.7 kg a week', steady, -0.7],
  ] as const)('%s', (_, entries, expected) => {
    const rate = weightRate(weightTrend(entries), '2026-10-15');
    expect(rate === undefined ? undefined : r1(rate)).toEqual(expected);
  });
});

describe('weight goals', () => {
  const goal: WeightGoal = { id: 'g', startDate: '2026-10-01', startKg: 90, targetKg: 85, paceKgWeek: 0.5, status: 'active' };
  it('expects the date from distance over pace', () => {
    expect(expectedGoalDate(goal)).toBe('2026-12-10');
  });
  it.each([
    ['on the plan line is on track', 89, 'on_track', 1],
    ['a kilo under the line is ahead', 88, 'ahead', 2],
    ['a kilo over the line is behind', 90, 'behind', 0],
    ['crossing the target is reached', 84.9, 'reached', 5],
  ] as const)('%s', (_, trend, status, done) => {
    // Two weeks in, the plan line is at 89 kg.
    const p = goalProgress(goal, trend, '2026-10-15');
    expect([p.status, r1(p.progress * 5)]).toEqual([status, done]);
  });
  it('works for gaining', () => {
    const p = goalProgress({ ...goal, startKg: 60, targetKg: 65 }, 62, '2026-10-15');
    expect([p.direction, p.status, r1(p.aheadKg)]).toEqual(['gain', 'ahead', 1]);
  });
  it('caps pace at 1% of the start weight a week', () => {
    expect(allowedPaces('kg', 60)).toEqual([0.25, 0.5]);
    expect(allowedPaces('lb', 60).map(r1)).toEqual([0.2, 0.5]);
  });
});
