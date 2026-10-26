import { describe, expect, it } from 'vitest';
import type { AgendaItem, PlanRole } from './agenda';
import { evaluateMove } from './moving';

const run = (key: string, date: string, role: PlanRole): AgendaItem => ({
  key,
  lane: 'run',
  date,
  originalDate: date,
  source: { type: 'plan_workout', planWorkoutId: key, planId: 'p', weekIndex: 1, role },
  title: key,
  refId: key,
  hard: role === 'long' || role.startsWith('quality'),
  estSeconds: 1800,
  status: 'pending',
});

// Tue tempo, Thu easy, Sat easy, Sun long.
const week = [run('tempo', '2026-10-27', 'quality'), run('easyThu', '2026-10-29', 'easy'), run('easySat', '2026-10-31', 'easy'), run('long', '2026-11-01', 'long')];

describe('evaluateMove', () => {
  it('offers a swap when the target day already has a run', () => {
    const e = evaluateMove(week, 'tempo', '2026-10-29');
    expect(e.occupants.map((o) => o.key)).toEqual(['easyThu']);
    expect(e.warnings).toEqual([]);
  });

  it('warns on back-to-back hard days and suggests a swap that avoids it', () => {
    const e = evaluateMove(week, 'tempo', '2026-10-31'); // Saturday, next to Sunday long
    expect(e.warnings).toEqual([{ type: 'back_to_back_hard', key: 'tempo', otherKey: 'long' }]);
    expect(e.suggestion).toEqual({ type: 'swap', withKey: 'easyThu', date: '2026-10-29' });
  });

  it('asks for scope only on schedule occurrences', () => {
    const stretch: AgendaItem = { ...run('s@2026-10-27', '2026-10-27', 'easy'), lane: 'stretch', hard: false, source: { type: 'schedule', scheduleId: 's', routineId: 'r' } };
    expect(evaluateMove([...week, stretch], 's@2026-10-27', '2026-10-28').asksScope).toBe(true);
    expect(evaluateMove(week, 'easyThu', '2026-10-28').asksScope).toBe(false);
  });
});
