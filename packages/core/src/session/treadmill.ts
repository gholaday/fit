import { zonePace } from '../vdot';
import type { Step } from '../workout';
import type { StepLogEntry } from './player';

/**
 * Treadmill mode (spec §5 Treadmill): distance is speed x time per step, from the speed
 * you set on the app (which should match the belt). Each step suggests a target speed
 * derived from its pace zone; the +/- buttons record what you actually ran.
 */

export interface TreadmillPrefs {
  /** Remembered default easy speed. */
  easyKph: number;
  walkKph: number;
}

export const DEFAULT_TREADMILL: TreadmillPrefs = { easyKph: 9.0, walkKph: 5.0 };

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Pace to belt speed, rounded to 0.1 km/h like the treadmill display. */
export const kphFromPace = (secPerKm: number) => round1(3600 / secPerKm);

/**
 * Suggested speed for a step: an explicit treadmill target, else its pace zone's target
 * pace or the middle of its pace range, else the remembered walk or easy speed. Sprints and effort steps get the
 * easy speed as a starting point; you set them by feel.
 */
export function treadmillTarget(step: Step, prefs: TreadmillPrefs, vdot?: number): { speedKph: number; inclinePct?: number } {
  const t = step.target;
  if (t.type === 'treadmill') return t.inclinePct === undefined ? { speedKph: t.speedKph } : { speedKph: t.speedKph, inclinePct: t.inclinePct };
  if (t.type === 'pace_range') return { speedKph: kphFromPace((t.minSecPerKm + t.maxSecPerKm) / 2) };
  if (t.type === 'pace_zone' && vdot !== undefined) return { speedKph: kphFromPace(zonePace(vdot, t.zone).targetSecPerKm) };
  if (step.activity === 'walk' || step.activity === 'rest') return { speedKph: prefs.walkKph };
  return { speedKph: prefs.easyKph };
}

/** A speed change at an active (pause-excluded) time. The first segment starts at 0. */
export interface SpeedSegment {
  activeMs: number;
  speedKph: number;
}

/** Distance covered by `activeMs`, integrating the speed changes. */
export function treadmillDistance(segments: readonly SpeedSegment[], activeMs: number): number {
  let m = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (s.activeMs >= activeMs) break;
    const end = Math.min(segments[i + 1]?.activeMs ?? activeMs, activeMs);
    m += (s.speedKph / 3.6) * ((end - s.activeMs) / 1000);
  }
  return m;
}

/** Records a speed change; a change at the same instant replaces the last one. */
export function setSpeed(segments: readonly SpeedSegment[], activeMs: number, speedKph: number): SpeedSegment[] {
  const speed = Math.max(0, round1(speedKph));
  const kept = segments.filter((s) => s.activeMs < activeMs);
  if (kept.at(-1)?.speedKph === speed) return kept;
  return [...kept, { activeMs, speedKph: speed }];
}

/**
 * "Treadmill says X km" and Timer's manual distance: scale every step's distances so the
 * total matches. Steps with no distance (timer) are spread by active time instead.
 */
export function rescaleLog(log: readonly StepLogEntry[], totalM: number): StepLogEntry[] {
  const recorded = log.at(-1)?.endDistanceM ?? 0;
  if (recorded > 0) {
    const f = totalM / recorded;
    return log.map((e) => ({ ...e, startDistanceM: e.startDistanceM * f, endDistanceM: e.endDistanceM * f }));
  }
  const activeTotal = log.reduce((a, e) => a + (e.endActiveMs - e.startActiveMs), 0);
  if (activeTotal === 0) return [...log];
  let acc = 0;
  return log.map((e) => {
    const start = acc;
    acc += (totalM * (e.endActiveMs - e.startActiveMs)) / activeTotal;
    return { ...e, startDistanceM: start, endDistanceM: acc };
  });
}
