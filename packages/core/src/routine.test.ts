import { describe, expect, it } from 'vitest';
import { prefillSets, routineSeconds, stretchSteps, type RoutineItems } from './routine';
import { createPlayer, playerReducer, snapshot } from './session/player';

const stretch: Extract<RoutineItems, { kind: 'stretch' }> = {
  schemaVersion: 2,
  kind: 'stretch',
  transitionS: 8,
  items: [
    { exerciseId: 'cat', holdS: 30, sides: 'none' },
    { exerciseId: 'pigeon', holdS: 30, sides: 'both' },
  ],
};

describe('stretch routines', () => {
  it('expands two-sided moves with a switch and puts transitions only between moves', () => {
    expect(stretchSteps(stretch).map((s) => s.label ?? 'hold')).toEqual(['hold', 'Next', 'Left', 'Switch sides', 'Right']);
  });

  it('duration is holds x sides plus switches plus transitions', () => {
    expect(routineSeconds(stretch)).toBe(30 + 8 + (30 + 5 + 30));
  });
});

describe('strength prefill', () => {
  const item = { exerciseId: 'bench', sets: 3, reps: 8, restS: 120 };

  it('prefills from last time, repeating the last set when last time had fewer', () => {
    const rows = prefillSets(item, [
      { exerciseId: 'bench', setIdx: 0, reps: 8, weightKg: 60 },
      { exerciseId: 'bench', setIdx: 1, reps: 7, weightKg: 60 },
    ]);
    expect(rows.map((r) => [r.reps, r.weightKg, r.previous?.reps])).toEqual([
      [8, 60, 8],
      [7, 60, 7],
      [7, 60, undefined],
    ]);
  });

  it('falls back to the routine target with no history', () => {
    expect(prefillSets(item, [])[0]).toEqual({ setIdx: 0, reps: 8 });
  });
});

describe('guided stretch on the player', () => {
  it('+15 s extends the hold, and jump goes back to an earlier move', () => {
    const T = 1_000_000;
    let p = playerReducer(createPlayer(stretchSteps(stretch)), { type: 'start', t: T });
    p = playerReducer(p, { type: 'extend', t: T + 10_000, seconds: 15 });
    expect(snapshot(p, T + 10_000, 0).stepRemainingMs).toBe(35_000);
    p = playerReducer(p, { type: 'tick', t: T + 46_000, distanceM: 0 }); // 45 s hold done, into "Next"
    expect(p.stepIdx).toBe(1);
    p = playerReducer(p, { type: 'jump', t: T + 47_000, distanceM: 0, idx: 0 });
    expect(p.stepIdx).toBe(0);
    expect(snapshot(p, T + 50_000, 0).stepElapsedMs).toBe(3000);
  });
});
