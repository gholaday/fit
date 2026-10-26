import { describe, expect, it } from 'vitest';
import { adaptPlan, shiftRestOfWeek, type AdaptItem } from './adapt';

// Week 1 is Mon 2026-10-26 to Sun 2026-11-01; week 2 starts 2026-11-02.
const item = (id: string, date: string, role: AdaptItem['role'], weekIndex = 1, status: AdaptItem['status'] = 'scheduled'): AdaptItem => ({
  id,
  date,
  weekIndex,
  role,
  status,
  hard: role === 'long' || role.startsWith('quality'),
  name: id,
});

const run = (today: string, items: AdaptItem[], kind: 'race' | 'fitness' = 'race') => adaptPlan({ today, kind, endDate: '2026-12-31', items });

describe('adaptPlan', () => {
  it.each([
    ['drops a missed easy run', '2026-10-28', [item('easy', '2026-10-27', 'easy', 1), item('long', '2026-11-01', 'long')], [{ type: 'missed', id: 'easy' }]],
    [
      'moves a missed quality run to the next free day this week, away from hard days',
      '2026-10-28',
      [item('q', '2026-10-27', 'quality'), item('e', '2026-10-28', 'easy'), item('long', '2026-11-01', 'long')],
      [{ type: 'move', id: 'q', to: '2026-10-29' }],
    ],
    [
      'moves a missed long run within 2 days',
      '2026-11-02',
      [item('done', '2026-10-28', 'easy', 1, 'done'), item('long', '2026-11-01', 'long'), item('q', '2026-11-04', 'quality', 2), item('long2', '2026-11-08', 'long', 2)],
      [{ type: 'move', id: 'long', to: '2026-11-02' }],
    ],
    [
      'holds next week\'s long run when the missed one cannot move',
      '2026-11-04',
      [item('long', '2026-11-01', 'long'), item('done', '2026-10-28', 'easy', 1, 'done'), item('long2', '2026-11-08', 'long', 2)],
      [
        { type: 'missed', id: 'long' },
        { type: 'repeat_long', fromId: 'long', toId: 'long2' },
      ],
    ],
    [
      'race plan: a whole missed week is dropped and the next is 20% lighter',
      '2026-11-03',
      [item('a', '2026-10-27', 'easy'), item('b', '2026-11-01', 'long'), item('c', '2026-11-04', 'quality', 2)],
      [
        { type: 'missed', id: 'a' },
        { type: 'missed', id: 'b' },
        { type: 'scale_week', week: 2, factor: 0.8 },
      ],
    ],
    ['fitness plan: a whole missed week repeats', '2026-11-03', [item('a', '2026-10-27', 'easy'), item('c', '2026-11-04', 'easy', 2)], [{ type: 'shift_weeks', fromWeek: 1 }]],
  ] as const)('%s', (_label, today, items, actions) => {
    expect(run(today, [...items], _label.startsWith('fitness') ? 'fitness' : 'race').actions).toEqual(actions);
  });

  it('asks to rebuild after two missed weeks', () => {
    const r = run('2026-11-10', [item('a', '2026-10-27', 'easy'), item('b', '2026-11-03', 'easy', 2), item('c', '2026-11-11', 'easy', 3)]);
    expect(r).toEqual({ actions: [], events: [], rebuildPrompt: true });
  });

  it('shifts the rest of the week by a day', () => {
    const items = [item('a', '2026-10-27', 'easy'), item('b', '2026-10-29', 'quality'), item('c', '2026-11-01', 'long'), item('d', '2026-11-03', 'easy', 2)];
    expect(shiftRestOfWeek(items, '2026-10-28')).toEqual([
      { id: 'c', to: '2026-11-02' },
      { id: 'b', to: '2026-10-30' },
    ]);
  });
});
