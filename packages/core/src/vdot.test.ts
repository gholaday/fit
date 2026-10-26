import { describe, expect, it } from 'vitest';
import { vdotFromRace, zonePace } from './vdot';

describe('vdotFromRace', () => {
  // Reference values from Daniels' tables.
  it.each([
    ['5K 20:00', 5000, 1200, 49.8],
    ['5K 25:00', 5000, 1500, 38.3],
    ['mile 7:00', 1609.344, 420, 40.7],
  ])('%s', (_, meters, seconds, expected) => {
    expect(vdotFromRace(meters, seconds)).toBeCloseTo(expected, 0);
  });
});

describe('zonePace', () => {
  it('harder zones are faster', () => {
    const order = (['easy', 'steady', 'tempo', 'threshold', 'interval', 'repetition'] as const).map((z) => zonePace(45, z).targetSecPerKm);
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });
});
