import { describe, expect, it } from 'vitest';
import { counterIds, parseWorkout } from './dsl';
import { TIME_TRIALS, trialResult, vdotBumpSuggestion } from './pace';
import type { StepResult } from './session/track';
import { zonePace } from './vdot';
import { flattenSteps, type Step } from './workout';

const result = (step: Step, durationS: number, distanceM: number, avgPaceSecPerKm?: number): StepResult => {
  const r: StepResult = { idx: 0, step, durationS, distanceM, skipped: false };
  if (avgPaceSecPerKm !== undefined) r.avgPaceSecPerKm = avgPaceSecPerKm;
  return r;
};

describe('time trials', () => {
  it('reads the trial step of each built-in trial', () => {
    for (const tt of TIME_TRIALS) {
      const steps = flattenSteps(parseWorkout(tt.dsl, counterIds()));
      const trial = steps.find((s) => s.label === 'Time trial')!;
      const meters = trial.duration.type === 'distance' ? trial.duration.meters : 0;
      const r = trialResult(steps.map((s) => (s === trial ? result(s, meters * 0.3, meters) : result(s, 600, 1500))));
      expect(r?.meters).toBe(meters);
    }
  });

  it('turns a 3 km in 12:30 into VDOT and ignores a cut-short trial', () => {
    const [trial] = flattenSteps(parseWorkout('3km @ RPE 9', counterIds()));
    expect(trialResult([result(trial!, 750, 3010)])).toEqual({ meters: 3000, seconds: 750, vdot: 45.7 });
    expect(trialResult([result(trial!, 500, 2000)])).toBeUndefined();
  });
});

describe('vdotBumpSuggestion', () => {
  const vdot = 45;
  const [interval, easy] = flattenSteps(parseWorkout('800m @ interval, 20min easy', counterIds()));
  const fast = zonePace(vdot, 'interval').minSecPerKm - 5;
  const quality = (pace: number) => [result(interval!, 200, 800, pace), result(easy!, 1200, 3000, 400)];
  const easyOnly = [result(easy!, 1200, 3000, 400)];

  it.each([
    ['two fast quality sessions, an easy run between', [quality(fast), easyOnly, quality(fast)], 46],
    ['only one fast session', [quality(fast), quality(fast + 20)], undefined],
    ['the newest one was slow', [quality(fast + 20), quality(fast), quality(fast)], undefined],
  ])('%s', (_label, sessions, expected) => {
    expect(vdotBumpSuggestion(sessions, vdot)).toBe(expected);
  });
});
