import { describe, expect, it } from 'vitest';
import { adherenceByWeek, bestEfforts, dayStreak, periodTotals, personalBests, sessionStats, weekStreak, type RunRow, type SessionStats } from './stats';
import type { StepResult } from './session/track';
import type { Step } from './workout';

// Steady 4 m/s for 1500 m with one 30 s burst at 5 m/s from 400 m.
const track = () => {
  const out = [];
  let d = 0;
  for (let t = 0; d < 1500; t++) {
    out.push({ tOffsetMs: t * 1000, distanceM: d });
    d += t >= 100 && t < 130 ? 5 : 4;
  }
  return out;
};

describe('bestEfforts', () => {
  it('finds the fastest window and skips distances longer than the run', () => {
    const [k] = bestEfforts(track(), [], [1000, 5000]);
    // 150 m at 5 m/s (30 s) plus 850 m at 4 m/s (212.5 s).
    expect(k).toMatchObject({ meters: 1000, seconds: 243 });
    expect(bestEfforts(track(), [], [5000])).toEqual([]);
  });

  it('does not count paused time', () => {
    // 1000 m in 250 s, with a 60 s pause in the middle that the track spans.
    const samples = [
      { tOffsetMs: 0, distanceM: 0 },
      { tOffsetMs: 125_000, distanceM: 500 },
      { tOffsetMs: 185_000, distanceM: 500 },
      { tOffsetMs: 310_000, distanceM: 1000 },
    ];
    expect(bestEfforts(samples, [[125_000, 185_000]], [1000])[0]!.seconds).toBe(250);
  });
});

const step = (activity: Step['activity'], target: Step['target'] = { type: 'none' }): Step => ({ activity, duration: { type: 'open' }, target }) as Step;
const result = (s: Step, distanceM: number, durationS: number): StepResult => ({ idx: 0, step: s, distanceM, durationS, skipped: false });

describe('sessionStats', () => {
  it('splits distance by activity and keeps only easy running for the easy pace', () => {
    const s = sessionStats({
      steps: [result(step('run'), 1000, 360), result(step('sprint'), 200, 40), result(step('walk'), 300, 200), result(step('run', { type: 'effort', rpe: 8 }), 800, 200)],
      distanceM: 2400,
      samples: [],
      pauses: [],
    });
    expect(s).toEqual({ runM: 1900, walkM: 300, sprintM: 200, easyM: 1000, easyS: 360, bests: [] });
  });
});

const stats = (over: Partial<SessionStats> = {}): SessionStats => ({ runM: 0, walkM: 0, sprintM: 0, easyM: 0, easyS: 0, bests: [], ...over });

describe('aggregates', () => {
  it('buckets runs by week, zero-filled, with imported walks as walking', () => {
    const rows: RunRow[] = [
      { sessionId: 'a', date: '2026-10-27', distanceM: 5000, durationS: 1800, stats: stats({ runM: 4500, walkM: 500 }) },
      { sessionId: 'b', date: '2026-11-11', distanceM: 3000, durationS: 2400, walk: true },
    ];
    expect(periodTotals(rows, 'week', '2026-10-26', '2026-11-15').map((w) => [w.start, w.runs, w.runM, w.walkM])).toEqual([
      ['2026-10-26', 1, 4500, 500],
      ['2026-11-02', 0, 0, 0],
      ['2026-11-09', 1, 0, 3000],
    ]);
    expect(periodTotals(rows, 'month', '2026-10-01', '2026-11-30').map((m) => [m.start, m.distanceM])).toEqual([
      ['2026-10-01', 5000],
      ['2026-11-01', 3000],
    ]);
  });

  it('keeps the fastest effort per distance across runs', () => {
    const rows = [
      { sessionId: 'a', date: '2026-10-01', stats: stats({ bests: [{ meters: 1000, seconds: 250, startOffsetMs: 0 }] }) },
      { sessionId: 'b', date: '2026-10-10', stats: stats({ bests: [{ meters: 1000, seconds: 240, startOffsetMs: 0 }, { meters: 5000, seconds: 1400, startOffsetMs: 0 }] }) },
    ];
    expect(personalBests(rows).map((p) => [p.meters, p.seconds, p.sessionId])).toEqual([
      [1000, 240, 'b'],
      [5000, 1400, 'b'],
    ]);
  });

  it.each([
    ['this week reached the minimum', ['2026-10-27', '2026-10-28', '2026-10-20', '2026-10-22'], 2, 2],
    ['this week not there yet, so it runs to last week', ['2026-10-27', '2026-10-20', '2026-10-22'], 2, 1],
    ['a gap ends it', ['2026-10-27', '2026-10-13'], 1, 1],
  ] as const)('week streak: %s', (_label, dates, min, expected) => {
    expect(weekStreak(dates, min, '2026-10-29')).toBe(expected);
  });

  it('day streak counts back from today or yesterday', () => {
    expect(dayStreak(['2026-10-28', '2026-10-27', '2026-10-25'], '2026-10-29')).toBe(2);
    expect(dayStreak(['2026-10-29', '2026-10-28'], '2026-10-29')).toBe(2);
  });

  it('adherence counts done against what was due', () => {
    const items = [
      { date: '2026-10-26', status: 'done' },
      { date: '2026-10-27', status: 'skipped' },
      { date: '2026-10-28', status: 'scheduled' }, // past, still pending
      { date: '2026-10-30', status: 'scheduled' }, // ahead, not due
      { date: '2026-10-29', status: 'moved' },
      { date: '2026-11-03', status: 'scheduled' },
    ];
    expect(adherenceByWeek(items, '2026-10-29')).toEqual([
      { start: '2026-10-26', done: 1, total: 3, rate: 1 / 3 },
      { start: '2026-11-02', done: 0, total: 0, rate: undefined },
    ]);
  });
});
