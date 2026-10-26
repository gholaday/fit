import type { StepResult } from './session/track';
import { vdotFromRace, zonePace } from './vdot';

/**
 * Pace profile sources and updates (spec §6): built-in time trials, the trial result
 * from a recorded session, and the +1 VDOT suggestion (a prompt, never automatic).
 */

/** Built-in time trials. The trial step carries the "Time trial" label. */
export const TIME_TRIALS = [
  { id: 'tt-1mi', name: '1 mile time trial', dsl: 'Warm up: 10min easy, 4x [ 20s run @ RPE 7, 40s walk ], Time trial: 1mi run @ RPE 10, Cool down: 10min easy' },
  { id: 'tt-3km', name: '3 km time trial', dsl: 'Warm up: 10min easy, 4x [ 20s run @ RPE 7, 40s walk ], Time trial: 3km run @ RPE 9, Cool down: 10min easy' },
  { id: 'tt-5km', name: '5 km time trial', dsl: 'Warm up: 10min easy, Time trial: 5km run @ RPE 9, Cool down: 10min easy' },
] as const;

export interface TrialResult {
  meters: number;
  seconds: number;
  vdot: number;
}

/**
 * The trial effort in a finished session: the longest completed distance step labeled
 * "Time trial" or run at RPE 9 or more (the plans' retest is "3km @ RPE 9"). Uses the
 * planned distance with the recorded time, since the step ends when that distance is reached.
 */
export function trialResult(steps: readonly StepResult[]): TrialResult | undefined {
  let best: { meters: number; seconds: number } | undefined;
  for (const r of steps) {
    const s = r.step;
    if (r.skipped || s.duration.type !== 'distance' || s.activity !== 'run') continue;
    const isTrial = s.label?.toLowerCase() === 'time trial' || (s.target.type === 'effort' && s.target.rpe >= 9);
    if (!isTrial || r.durationS <= 0 || r.distanceM < s.duration.meters * 0.9) continue;
    if (!best || s.duration.meters > best.meters) best = { meters: s.duration.meters, seconds: r.durationS };
  }
  if (!best || best.meters < 1000) return undefined;
  return { ...best, vdot: Math.round(vdotFromRace(best.meters, best.seconds) * 10) / 10 };
}

/**
 * True when a session's threshold or interval steps averaged faster than the fast end of
 * their zone (all of them, at least one).
 */
export function beatQualityTargets(steps: readonly StepResult[], vdot: number): boolean {
  const quality = steps.filter((r) => !r.skipped && r.step.target.type === 'pace_zone' && (r.step.target.zone === 'threshold' || r.step.target.zone === 'interval'));
  if (quality.length === 0) return false;
  return quality.every((r) => {
    if (r.avgPaceSecPerKm === undefined || r.step.target.type !== 'pace_zone') return false;
    return r.avgPaceSecPerKm < zonePace(vdot, r.step.target.zone).minSecPerKm;
  });
}

/**
 * Suggest +1 VDOT after two sessions in a row (newest first) that beat their quality
 * targets. Sessions without threshold or interval steps are skipped, not counted against.
 */
export function vdotBumpSuggestion(sessionsNewestFirst: readonly (readonly StepResult[])[], vdot: number): number | undefined {
  let streak = 0;
  for (const steps of sessionsNewestFirst) {
    const hasQuality = steps.some((r) => r.step.target.type === 'pace_zone' && (r.step.target.zone === 'threshold' || r.step.target.zone === 'interval'));
    if (!hasQuality) continue;
    if (!beatQualityTargets(steps, vdot)) break;
    if (++streak >= 2) return Math.round((vdot + 1) * 10) / 10;
  }
  return undefined;
}
