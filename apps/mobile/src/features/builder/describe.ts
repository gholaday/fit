/** How builder steps read in one line, and the pace lookup for estimates. Display only. */
import { type DistanceUnit, type PaceLookup, type Step, type Target, formatBpmRange, formatPaceRange, zonePace } from '@fit/core';
import { formatSpeed } from '@/features/run/speed';
import { stepAmount } from '@/features/run/steps';
import { ZONE_LABEL } from './StepEditor';

export function targetText(t: Target, unit: DistanceUnit, vdot?: number): string | undefined {
  switch (t.type) {
    case 'pace_zone': {
      const r = vdot !== undefined ? zonePace(vdot, t.zone) : undefined;
      return r ? `${ZONE_LABEL[t.zone]} pace, ${formatPaceRange(r.minSecPerKm, r.maxSecPerKm, unit)}` : `${ZONE_LABEL[t.zone]} pace`;
    }
    case 'pace_range':
      return formatPaceRange(t.minSecPerKm, t.maxSecPerKm, unit);
    case 'hr_zone':
      return `HR zone ${t.zone}`;
    case 'hr_range':
      return formatBpmRange(t.minBpm, t.maxBpm);
    case 'hr_max':
      return `Under ${t.maxBpm} bpm`;
    case 'effort':
      return `Effort ${t.rpe} of 10`;
    case 'treadmill':
      return t.inclinePct ? `${formatSpeed(t.speedKph, unit)}, ${t.inclinePct} % incline` : formatSpeed(t.speedKph, unit);
    default:
      return undefined;
  }
}

/** "10:00, Easy pace" or "0.25 mi, Effort 9 of 10". */
export function stepLine(step: Step, unit: DistanceUnit, vdot?: number): string {
  const target = targetText(step.target, unit, vdot);
  return target ? `${stepAmount(step, unit)}, ${target}` : stepAmount(step, unit);
}

/** Pace for time and distance estimates: zone paces from the profile, ranges at their middle, belt speed. */
export function paceLookup(vdot: number | undefined): PaceLookup {
  return (step) => {
    const t = step.target;
    if (t.type === 'pace_zone' && vdot !== undefined) return zonePace(vdot, t.zone).targetSecPerKm;
    if (t.type === 'pace_range') return (t.minSecPerKm + t.maxSecPerKm) / 2;
    if (t.type === 'treadmill' && t.speedKph > 0) return 3600 / t.speedKph;
    return undefined;
  };
}
