import { describe, expect, it } from 'vitest';
import { computeRecords, currentRecords, oneRepMax, type LiftRecordInput, type RunRecordInput } from './records';
import { longestNonstopS } from './stats';

const run = (id: string, date: string, distanceM: number, durationS: number, fiveK?: number): RunRecordInput => ({
  sessionId: id,
  date,
  startedAt: `${date}T07:00:00.000Z`,
  distanceM,
  durationS,
  stats: { bests: fiveK ? [{ meters: 5000, seconds: fiveK, startOffsetMs: 0 }] : [], nonstopS: durationS },
});

const lift = (id: string, date: string, sets: [string, number, number?, number?][]): LiftRecordInput => ({
  sessionId: id,
  date,
  startedAt: `${date}T18:00:00.000Z`,
  sets: sets.map(([exerciseId, reps, weightKg, durationS], setIdx) => ({ exerciseId, setIdx, reps, ...(weightKg ? { weightKg } : {}), ...(durationS ? { durationS } : {}) })),
});

const summary = (events: ReturnType<typeof computeRecords>) => events.map((e) => [e.sessionId, e.key, e.value, e.celebrate]);

describe('computeRecords', () => {
  it('keeps the first value quietly, celebrates improvements and firsts, ignores slower runs', () => {
    const events = computeRecords([run('a', '2026-10-05', 5000, 1500, 1500), run('b', '2026-10-07', 5000, 1600, 1600), run('c', '2026-10-09', 5200, 1480, 1450)], []);
    expect(summary(events.filter((e) => e.key === 'run:effort:5000' || e.key.startsWith('run:first')))).toEqual([
      ['a', 'run:effort:5000', 1500, false],
      ['a', 'run:first:5000', 5000, true],
      ['c', 'run:effort:5000', 1450, true],
    ]);
    expect(events.find((e) => e.sessionId === 'c' && e.key === 'run:effort:5000')!.previous).toBe(1500);
  });

  it('biggest week celebrates once when a week overtakes, then rises quietly', () => {
    const events = computeRecords(
      [run('a', '2026-10-05', 10000, 3000), run('b', '2026-10-12', 6000, 1800), run('c', '2026-10-14', 6000, 1800), run('d', '2026-10-15', 3000, 900)],
      [],
    ).filter((e) => e.key === 'run:biggest_week');
    expect(summary(events)).toEqual([
      ['a', 'run:biggest_week', 10000, false],
      ['c', 'run:biggest_week', 12000, true],
      ['d', 'run:biggest_week', 15000, false],
    ]);
  });

  it('tracks all six lift records per exercise', () => {
    const events = computeRecords(
      [],
      [
        lift('s1', '2026-10-05', [['squat', 5, 100], ['pullup', 8], ['plank', 0, undefined, 60]]),
        lift('s2', '2026-10-08', [['squat', 3, 110], ['squat', 8, 90], ['pullup', 10], ['plank', 0, undefined, 75]]),
      ],
    );
    const current = Object.fromEntries(currentRecords(events).map((e) => [e.key, [e.value, e.celebrate]]));
    expect(current).toEqual({
      'lift:squat:heaviest': [110, true],
      // 110 x (1 + 3/30) = 121 beats 100 x (1 + 5/30) = 116.7.
      'lift:squat:one_rep_max': [121, true],
      'lift:squat:set_volume': [720, true],
      'lift:squat:session_volume': [1050, true],
      'lift:pullup:most_reps': [10, true],
      'lift:plank:longest_hold': [75, true],
    });
  });
});

describe('records helpers', () => {
  it('estimates one rep max only up to 12 reps', () => {
    expect(oneRepMax(100, 1)).toBe(100);
    expect(oneRepMax(100, 5)).toBe(116.7);
    expect(oneRepMax(100, 15)).toBeUndefined();
  });

  it('longest non-stop run breaks at walk steps and walk phases', () => {
    const run = { id: 'r', activity: 'run', duration: { type: 'open' }, target: { type: 'none' } } as const;
    const walk = { ...run, id: 'w', activity: 'walk' } as const;
    const entries = [
      { step: walk, startActiveMs: 0, endActiveMs: 300_000 },
      { step: run, startActiveMs: 300_000, endActiveMs: 900_000 },
      { step: run, startActiveMs: 900_000, endActiveMs: 1_500_000 },
    ];
    expect(longestNonstopS(entries)).toBe(1200);
    const walkPhase = { phase: 'walk' as const, stepIdx: 1, startActiveMs: 600_000, endActiveMs: 660_000, startDistanceM: 0, endDistanceM: 0 };
    expect(longestNonstopS(entries, [walkPhase])).toBe(840);
  });
});
