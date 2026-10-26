import type { DistanceUnit } from '../units';
import { METERS_PER_MILE } from '../units';
import type { Step } from '../workout';
import { haversineM, type TrackPoint } from './geo';
import type { StepLogEntry } from './player';

/** Post-session math for the summary and replay (spec §5 summary, route map & replay). */

export interface DistancePoint {
  tOffsetMs: number;
  distanceM: number;
}

/** Cumulative distance along the track. Same length as the input. */
export function cumulativeDistance(points: readonly TrackPoint[]): DistancePoint[] {
  let total = 0;
  return points.map((p, i) => {
    if (i > 0) total += haversineM(points[i - 1]!, p);
    return { tOffsetMs: p.tOffsetMs, distanceM: total };
  });
}

export interface Split {
  /** 1-based. */
  index: number;
  distanceM: number;
  durationS: number;
  paceSecPerKm: number;
  /** The last split is usually partial. */
  partial: boolean;
}

/**
 * Splits per mile or km, interpolating the crossing time between samples. Pass
 * `pauses` as [startOffset, endOffset] ranges so paused time is excluded.
 */
export function splits(samples: readonly DistancePoint[], unit: DistanceUnit, pauses: readonly (readonly [number, number])[] = []): Split[] {
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const last = samples[samples.length - 1];
  if (!last || last.distanceM <= 0) return [];

  const activeAt = (offset: number) =>
    offset - pauses.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(offset, b) - a), 0);

  const crossing = (meters: number): number => {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      if (b.distanceM >= meters) {
        const f = b.distanceM === a.distanceM ? 0 : (meters - a.distanceM) / (b.distanceM - a.distanceM);
        return a.tOffsetMs + f * (b.tOffsetMs - a.tOffsetMs);
      }
    }
    return last.tOffsetMs;
  };

  const out: Split[] = [];
  let prevT = activeAt(samples[0]!.tOffsetMs);
  for (let i = 1; (i - 1) * unitM < last.distanceM; i++) {
    const target = Math.min(i * unitM, last.distanceM);
    const t = activeAt(crossing(target));
    const distanceM = target - (i - 1) * unitM;
    const durationS = (t - prevT) / 1000;
    if (distanceM < 1) break;
    out.push({ index: i, distanceM, durationS, paceSecPerKm: durationS / (distanceM / 1000), partial: distanceM < unitM - 0.5 });
    prevT = t;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Douglas-Peucker on a local flat projection (meters), for drawing 1-2k points.

function perpendicularM(p: TrackPoint, a: TrackPoint, b: TrackPoint, cosLat: number): number {
  const k = 111_320;
  const x = (q: TrackPoint) => q.lng * k * cosLat;
  const y = (q: TrackPoint) => q.lat * k;
  const dx = x(b) - x(a);
  const dy = y(b) - y(a);
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x(p) - x(a), y(p) - y(a));
  const t = Math.max(0, Math.min(1, ((x(p) - x(a)) * dx + (y(p) - y(a)) * dy) / len2));
  return Math.hypot(x(p) - (x(a) + t * dx), y(p) - (y(a) + t * dy));
}

export function simplify(points: readonly TrackPoint[], epsilonM: number): TrackPoint[] {
  if (points.length <= 2) return [...points];
  const cosLat = Math.cos((points[0]!.lat * Math.PI) / 180);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularM(points[i]!, points[start]!, points[end]!, cosLat);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilonM) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Simplify until at most `maxPoints` remain, doubling epsilon from 1 m. */
export function simplifyTo(points: readonly TrackPoint[], maxPoints = 1500): TrackPoint[] {
  let eps = 1;
  let out = simplify(points, eps);
  while (out.length > maxPoints && eps < 1000) {
    eps *= 2;
    out = simplify(points, eps);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Replay

/** Interpolated position at a wall-clock offset (binary search). */
export function positionAt(points: readonly TrackPoint[], tOffsetMs: number): { lat: number; lng: number; index: number } | undefined {
  if (points.length === 0) return undefined;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (tOffsetMs <= first.tOffsetMs) return { lat: first.lat, lng: first.lng, index: 0 };
  if (tOffsetMs >= last.tOffsetMs) return { lat: last.lat, lng: last.lng, index: points.length - 1 };
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.tOffsetMs <= tOffsetMs) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const f = (tOffsetMs - a.tOffsetMs) / (b.tOffsetMs - a.tOffsetMs);
  return { lat: a.lat + f * (b.lat - a.lat), lng: a.lng + f * (b.lng - a.lng), index: lo };
}

/** The step log entry covering a wall-clock offset. */
export function stepAtOffset(log: readonly StepLogEntry[], tOffsetMs: number): StepLogEntry | undefined {
  return log.find((e) => tOffsetMs >= e.startOffsetMs && tOffsetMs < e.endOffsetMs) ?? log[log.length - 1];
}

// ---------------------------------------------------------------------------
// Step breakdown

export interface StepResult {
  idx: number;
  step: Step;
  durationS: number;
  distanceM: number;
  avgPaceSecPerKm?: number;
  skipped: boolean;
}

export function stepResults(steps: readonly Step[], log: readonly StepLogEntry[]): StepResult[] {
  return log.map((e) => {
    const durationS = (e.endActiveMs - e.startActiveMs) / 1000;
    const distanceM = Math.max(0, e.endDistanceM - e.startDistanceM);
    const r: StepResult = { idx: e.idx, step: steps[e.idx]!, durationS, distanceM, skipped: e.skipped };
    if (distanceM >= 20 && durationS > 0) r.avgPaceSecPerKm = durationS / (distanceM / 1000);
    return r;
  });
}
