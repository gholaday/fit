import { describe, expect, it } from 'vitest';
import { duplicateItem, formatWorkout, itemFromChip, validateItems } from './builder';
import { counterIds, parseWorkout } from './dsl';
import type { Step, WorkoutItem } from './workout';

const strip = (items: WorkoutItem[]): unknown =>
  JSON.parse(JSON.stringify(items, (k, v: unknown) => (k === 'id' ? undefined : v)));

describe('formatWorkout', () => {
  it.each([
    ['Warm up: 5min walk, 10min easy, 6x [ Sprint: 30s sprint @ RPE 9, 1:30 walk ], Cool down: 5min walk', 'mi'],
    ['2km easy, 3x [ 800m run @ 4:50-5:00 /km, 400m walk ], 20min run @ Z2, 10min run @ under 140 bpm', 'km'],
    ['1mi run @ 128-145 bpm, open walk', 'mi'],
  ] as const)('round-trips %s', (text, unit) => {
    const items = parseWorkout(text, counterIds());
    expect(strip(parseWorkout(formatWorkout(items, unit), counterIds()))).toEqual(strip(items));
  });
});

describe('builder', () => {
  it('chips follow the step defaults, and duplicates get fresh ids', () => {
    const ids = counterIds('b');
    expect((itemFromChip('run', ids, { easyBy: 'hr' }) as Step).target).toEqual({ type: 'hr_zone', zone: 2 });
    const rep = itemFromChip('repeat', ids, { easyBy: 'pace' });
    const copy = duplicateItem(rep, ids);
    expect(strip([copy])).toEqual(strip([rep]));
    expect(JSON.stringify(copy)).not.toContain(rep.id);
  });

  it('blocks distance sprints, empty repeats and inverted ranges', () => {
    const items: WorkoutItem[] = [
      { id: 'a', activity: 'sprint', duration: { type: 'distance', meters: 100 }, target: { type: 'effort', rpe: 9 } },
      { id: 'b', repeat: 3, steps: [] },
      { id: 'c', activity: 'run', duration: { type: 'time', seconds: 600 }, target: { type: 'hr_range', minBpm: 150, maxBpm: 140 } },
    ];
    expect(validateItems(items).map((i) => `${i.item}: ${i.message}`)).toEqual(['0: Sprints are time based', '1: Add a step to the repeat', '2: Heart rate range must go low to high']);
    expect(validateItems([])).toHaveLength(1);
  });
});
