import { describe, expect, it } from 'vitest';
import { computeZones, estimateMaxHr, zoneForBpm, type HrProfileInput } from './hr';

const ranges = (input: HrProfileInput) => computeZones(input).map((z) => [z.minBpm, z.maxBpm]);

describe('computeZones', () => {
  it.each<[string, HrProfileInput, number[][]]>([
    ['karvonen', { method: 'hrr', maxHr: 185, restingHr: 55 }, [[120, 133], [134, 146], [147, 159], [160, 172], [173, 185]]],
    ['percent max', { method: 'max', maxHr: 190 }, [[95, 114], [115, 133], [134, 152], [153, 171], [172, 190]]],
    ['maf age 40', { method: 'maf', age: 40 }, [[120, 129], [130, 140], [141, 150], [151, 160], [161, 180]]],
    ['lthr', { method: 'lthr', lthr: 170 }, [[111, 136], [137, 153], [154, 162], [163, 170], [171, 180]]],
  ])('%s', (_, input, expected) => {
    expect(ranges(input)).toEqual(expected);
  });

  it('karvonen estimates max HR from age when not measured', () => {
    expect(computeZones({ method: 'hrr', age: 40, restingHr: 60 })[4]?.maxBpm).toBe(estimateMaxHr(40));
  });

  it('rejects resting HR above max', () => {
    expect(() => computeZones({ method: 'hrr', maxHr: 150, restingHr: 160 })).toThrow();
  });
});

describe('zoneForBpm', () => {
  const zones = computeZones({ method: 'hrr', maxHr: 185, restingHr: 55 });
  it.each([[133, 1], [134, 2], [200, 5]])('%i bpm -> Z%i', (bpm, zone) => {
    expect(zoneForBpm(bpm, zones)).toBe(zone);
  });
});
