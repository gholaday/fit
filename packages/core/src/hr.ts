import type { HrZone } from './workout';

/** Heart-rate profile and zone math (spec §7). */
export type HrMethod = 'hrr' | 'max' | 'maf' | 'lthr' | 'custom';

export interface HrZoneBand {
  zone: HrZone;
  minBpm: number;
  maxBpm: number;
}

export interface HrProfileInput {
  method: HrMethod;
  maxHr?: number;
  maxHrSource?: 'measured' | 'estimated';
  restingHr?: number;
  lthr?: number;
  age?: number;
  /** MAF adjustment, -5..+5. */
  mafAdjust?: number;
  /** Custom method: five [min, max] bpm pairs, Z1..Z5. */
  custom?: readonly (readonly [number, number])[];
}

export const ZONE_NAMES: Record<HrZone, string> = {
  1: 'Recovery',
  2: 'Aerobic base',
  3: 'Tempo',
  4: 'Threshold',
  5: 'Max effort',
};

/** Fox/Tanaka-style estimate used by the spec: 208 - 0.7 x age. */
export function estimateMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

/** Percent bounds per zone for the HRR and %max methods. */
const PCT_BOUNDS: readonly [number, number][] = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
];

/** Percent of LTHR per zone. Z2 is 80-89% per spec. */
const LTHR_BOUNDS: readonly [number, number][] = [
  [0.65, 0.8],
  [0.8, 0.9],
  [0.9, 0.95],
  [0.95, 1.0],
  [1.0, 1.06],
];

/**
 * Turn raw edges into contiguous integer bands: each zone starts 1 bpm above the
 * previous zone's top, so a bpm value belongs to exactly one zone.
 */
function contiguous(edges: readonly [number, number][]): HrZoneBand[] {
  const bands: HrZoneBand[] = [];
  edges.forEach(([lo, hi], i) => {
    const prev = bands[i - 1];
    const minBpm = prev ? prev.maxBpm + 1 : Math.round(lo);
    bands.push({ zone: (i + 1) as HrZone, minBpm, maxBpm: Math.max(minBpm, Math.round(hi)) });
  });
  return bands;
}

function required(value: number | undefined, name: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Heart rate method needs ${name}`);
  }
  return value;
}

function resolveMaxHr(input: HrProfileInput): number {
  if (input.maxHr !== undefined) return required(input.maxHr, 'max HR');
  return estimateMaxHr(required(input.age, 'max HR or age'));
}

export function computeZones(input: HrProfileInput): HrZoneBand[] {
  switch (input.method) {
    case 'hrr': {
      const max = resolveMaxHr(input);
      const rest = required(input.restingHr, 'resting HR');
      if (rest >= max) throw new Error('Resting HR must be below max HR');
      const reserve = max - rest;
      return contiguous(PCT_BOUNDS.map(([lo, hi]) => [rest + lo * reserve, rest + hi * reserve]));
    }
    case 'max': {
      const max = resolveMaxHr(input);
      return contiguous(PCT_BOUNDS.map(([lo, hi]) => [lo * max, hi * max]));
    }
    case 'maf': {
      const age = required(input.age, 'age');
      const maf = 180 - age + (input.mafAdjust ?? 0);
      const max = input.maxHr ?? estimateMaxHr(age);
      return contiguous([
        [maf - 20, maf - 11],
        [maf - 10, maf],
        [maf + 1, maf + 10],
        [maf + 11, maf + 20],
        [maf + 21, Math.max(max, maf + 21)],
      ]);
    }
    case 'lthr': {
      const lthr = required(input.lthr, 'LTHR');
      return contiguous(LTHR_BOUNDS.map(([lo, hi]) => [lo * lthr, hi * lthr]));
    }
    case 'custom': {
      const c = input.custom;
      if (!c || c.length !== 5) throw new Error('Custom zones need five ranges');
      return c.map(([minBpm, maxBpm], i) => ({ zone: (i + 1) as HrZone, minBpm, maxBpm }));
    }
  }
}

/** Zone for a bpm reading; below Z1 counts as Z1, above Z5 as Z5. */
export function zoneForBpm(bpm: number, zones: readonly HrZoneBand[]): HrZone {
  for (const band of zones) if (bpm <= band.maxBpm) return band.zone;
  return 5;
}

export function zoneBand(zones: readonly HrZoneBand[], zone: HrZone): HrZoneBand {
  const band = zones.find((z) => z.zone === zone);
  if (!band) throw new Error(`Missing zone ${zone}`);
  return band;
}

/**
 * Initial method for new profiles: % of max HR, which is Garmin's default and needs only
 * max HR or age. Karvonen and the others stay available in Settings.
 */
export const DEFAULT_HR_METHOD: HrMethod = 'max';
