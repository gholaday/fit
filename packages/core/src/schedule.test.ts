import { describe, expect, it } from 'vitest';
import { expandSchedule, rescheduleEntry, type ScheduleRow } from './schedule';

// Week of Mon 2026-10-26 to Sun 2026-11-01.
const legs: ScheduleRow = { id: 'legs', weekday: 4, routineId: 'r-legs' }; // Thursday
const dates = (rows: ScheduleRow[], overrides: Parameters<typeof expandSchedule>[1], start = '2026-10-26', end = '2026-11-01') =>
  expandSchedule(rows, overrides, start, end).map((o) => `${o.originalDate}>${o.date}`);

describe('expandSchedule', () => {
  it('repeats on its weekday', () => {
    expect(dates([legs], [], '2026-10-26', '2026-11-08')).toEqual(['2026-10-29>2026-10-29', '2026-11-05>2026-11-05']);
  });

  it('applies "just this time" moves and removals', () => {
    expect(dates([legs], [{ scheduleId: 'legs', originalDate: '2026-10-29', newDate: '2026-10-30' }])).toEqual(['2026-10-29>2026-10-30']);
    expect(dates([legs], [{ scheduleId: 'legs', originalDate: '2026-10-29', newDate: null }])).toEqual([]);
  });

  it('includes occurrences moved in from the previous week', () => {
    const moved = [{ scheduleId: 'legs', originalDate: '2026-10-22', newDate: '2026-10-26' }];
    expect(dates([legs], moved)).toEqual(['2026-10-29>2026-10-29', '2026-10-22>2026-10-26']);
  });
});

describe('rescheduleEntry', () => {
  it('keeps past weeks on the old day and moves this week onward', () => {
    const { ended, started } = rescheduleEntry(legs, '2026-10-29', '2026-10-30');
    const rows = [ended, { ...started, id: 'legs2' }];
    expect(dates(rows, [], '2026-10-19', '2026-11-08')).toEqual(['2026-10-22>2026-10-22', '2026-10-30>2026-10-30', '2026-11-06>2026-11-06']);
  });
});
