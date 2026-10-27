import { describe, expect, it } from 'vitest';
import type { AgendaStatus, Lane } from './agenda';
import { dayRing, ringHit } from './dayring';

const items = (...xs: [Lane, AgendaStatus][]) => xs.map(([lane, status]) => ({ lane, status }));
const round = (n: number) => Math.round(n * 1000) / 1000;

describe('dayRing', () => {
  it.each([
    ['three lanes take a third each', items(['stretch', 'pending'], ['run', 'done'], ['workout', 'pending']), [['run', 0.013, 0.321, 1], ['workout', 0.346, 0.654, 0], ['stretch', 0.679, 0.988, 0]]],
    ['two lanes take half each', items(['run', 'done'], ['stretch', 'pending']), [['run', 0.013, 0.488, 1], ['stretch', 0.513, 0.988, 0]]],
    ['one lane takes the whole ring with no gap', items(['workout', 'done'], ['workout', 'pending']), [['workout', 0, 1, 0.5]]],
    ['skipped items stay unfilled', items(['run', 'skipped'], ['run', 'done'], ['run', 'pending']), [['run', 0, 1, 0.333]]],
    ['rest day has no arcs', items(), []],
  ] as const)('%s', (_, input, expected) => {
    expect(dayRing(input).map((a) => [a.lane, round(a.start), round(a.end), round(a.fill)])).toEqual(expected);
  });
});

describe('ringHit', () => {
  const layout = { stepsR: 44, dayR: 32, width: 8 };
  const arcs = dayRing(items(['run', 'pending'], ['workout', 'pending'], ['stretch', 'pending']));
  it.each([
    ['top of the inner ring is the first lane', 0, -32, { ring: 'day', lane: 'run' }],
    ['bottom of the inner ring is the second lane', 0, 32, { ring: 'day', lane: 'workout' }],
    ['left of the inner ring is the third lane', -32, 0, { ring: 'day', lane: 'stretch' }],
    ['outer ring is steps', 44, 0, { ring: 'steps' }],
    ['middle is the center', 3, 4, { ring: 'center' }],
    ['outside both rings hits nothing', 60, 0, undefined],
  ] as const)('%s', (_, dx, dy, expected) => {
    expect(ringHit(dx, dy, arcs, layout)).toEqual(expected);
  });

  it('picks the nearest arc in a gap, and nothing on an empty day ring', () => {
    const gapAt = (1 / 3) * 2 * Math.PI;
    expect(ringHit(Math.sin(gapAt + 0.01) * 32, -Math.cos(gapAt + 0.01) * 32, arcs, layout)).toEqual({ ring: 'day', lane: 'workout' });
    expect(ringHit(0, -32, [], layout)).toBeUndefined();
  });
});
