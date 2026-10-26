import { describe, expect, it } from 'vitest';
import { counterIds, DslError, parseWorkout } from './dsl';
import type { Step } from './workout';
import { flattenSteps, totalSeconds } from './workout';

const parse = (s: string) => parseWorkout(s, counterIds());
const step = (s: string) => parse(s)[0] as Step;

describe('parseWorkout', () => {
  it('parses the spec run/walk/sprint example', () => {
    const items = parse('Warm up: 5m walk, 10m easy, 6x [ 30s sprint @ RPE 9, 90s walk ], Cool down: 5m walk');
    expect(items).toHaveLength(4);
    expect(flattenSteps(items)).toHaveLength(15);
    expect(step('Warm up: 5m walk').label).toBe('Warm up');
    expect(totalSeconds(items)).toBe(5 * 60 + 10 * 60 + 6 * 120 + 5 * 60);
  });

  it.each([
    ['10m', { type: 'time', seconds: 600 }],
    ['800m', { type: 'distance', meters: 800 }],
    ['1.5km', { type: 'distance', meters: 1500 }],
  ])('bare "m" below 100 is minutes, above is meters: %s', (src, duration) => {
    expect(step(`${src} walk`).duration).toEqual(duration);
  });

  it.each([
    ['10m easy', { type: 'pace_zone', zone: 'easy' }],
    ['40m @ Z2', { type: 'hr_zone', zone: 2 }],
    ['10m @ under 140 bpm', { type: 'hr_max', maxBpm: 140 }],
    ['400m @ 8:15-7:55 /mi', { type: 'pace_range', minSecPerKm: 295, maxSecPerKm: 308 }],
    ['30s sprint', { type: 'effort', rpe: 9 }],
  ])('target: %s', (src, target) => {
    expect(step(src).target).toEqual(target);
  });

  it.each([['30s sprint @ tempo'], ['200m sprint'], ['3x [ 1m run, 2x [ 30s walk ] ]'], ['10m swim']])('rejects %s', (src) => {
    expect(() => parse(src)).toThrow(DslError);
  });
});
