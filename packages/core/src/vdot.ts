import type { PaceZone } from './workout';

/** Jack Daniels VDOT (spec §6). Distances in meters, times in seconds, paces in sec/km. */

export function vdotFromRace(meters: number, seconds: number): number {
  if (meters <= 0 || seconds <= 0) throw new Error('Race distance and time must be positive');
  const t = seconds / 60;
  const v = meters / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pctMax;
}

/** Fraction of VDOT per zone: [slow end, fast end]. Easy uses the 66% midpoint for its single pace. */
export const ZONE_FRACTIONS: Record<PaceZone, readonly [number, number]> = {
  easy: [0.62, 0.7],
  steady: [0.75, 0.8],
  tempo: [0.83, 0.86],
  threshold: [0.86, 0.88],
  interval: [0.97, 1.0],
  repetition: [1.05, 1.1],
};

/** Pace (sec/km) at fraction `f` of VDOT: solve 0.000104 v^2 + 0.182258 v - (4.60 + f VDOT) = 0. */
export function paceAtFraction(vdot: number, f: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + f * vdot);
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return 60000 / v;
}

export interface PaceRange {
  /** Faster end (smaller number). */
  minSecPerKm: number;
  maxSecPerKm: number;
  /** Single display/target pace. */
  targetSecPerKm: number;
}

export function zonePace(vdot: number, zone: PaceZone): PaceRange {
  const [slow, fast] = ZONE_FRACTIONS[zone];
  const target = zone === 'easy' ? 0.66 : (slow + fast) / 2;
  return {
    minSecPerKm: Math.round(paceAtFraction(vdot, fast)),
    maxSecPerKm: Math.round(paceAtFraction(vdot, slow)),
    targetSecPerKm: Math.round(paceAtFraction(vdot, target)),
  };
}

export type PaceTable = Record<PaceZone, PaceRange>;

export function paceTable(vdot: number): PaceTable {
  return {
    easy: zonePace(vdot, 'easy'),
    steady: zonePace(vdot, 'steady'),
    tempo: zonePace(vdot, 'tempo'),
    threshold: zonePace(vdot, 'threshold'),
    interval: zonePace(vdot, 'interval'),
    repetition: zonePace(vdot, 'repetition'),
  };
}
