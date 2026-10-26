/**
 * Storage is always SI (meters, seconds, kg). These helpers convert and format for
 * display. Formatting follows the copy rules: units always shown, plain hyphen ranges.
 */
export type DistanceUnit = 'mi' | 'km';
export type WeightUnit = 'lb' | 'kg';

export interface UnitPrefs {
  distance: DistanceUnit;
  weight: WeightUnit;
}

export const DEFAULT_UNITS: UnitPrefs = { distance: 'mi', weight: 'lb' };

export const METERS_PER_MILE = 1609.344;
export const LB_PER_KG = 2.20462262;

export function metersToUnit(meters: number, unit: DistanceUnit): number {
  return unit === 'mi' ? meters / METERS_PER_MILE : meters / 1000;
}

export function unitToMeters(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * METERS_PER_MILE : value * 1000;
}

export function kgToUnit(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kg * LB_PER_KG : kg;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value / LB_PER_KG : value;
}

/** Seconds per km to seconds per display unit. */
export function paceToUnit(secPerKm: number, unit: DistanceUnit): number {
  return unit === 'mi' ? secPerKm * (METERS_PER_MILE / 1000) : secPerKm;
}

/** "9:05" from seconds. Hours shown when needed: "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "9:12 /mi" */
export function formatPace(secPerKm: number, unit: DistanceUnit): string {
  return `${formatClock(paceToUnit(secPerKm, unit))} /${unit}`;
}

/** "7:55-8:15 /mi". Faster pace (smaller number) first. */
export function formatPaceRange(minSecPerKm: number, maxSecPerKm: number, unit: DistanceUnit): string {
  return `${formatClock(paceToUnit(minSecPerKm, unit))}-${formatClock(paceToUnit(maxSecPerKm, unit))} /${unit}`;
}

/** "2.6 mi" */
export function formatDistance(meters: number, unit: DistanceUnit, digits = 1): string {
  return `${metersToUnit(meters, unit).toFixed(digits)} ${unit}`;
}

/** "40 min", "1 h 05 min" */
export function formatMinutes(totalSeconds: number): string {
  const min = Math.round(totalSeconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** "135 lb" */
export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${Math.round(kgToUnit(kg, unit))} ${unit}`;
}

/** "128-145 bpm" */
export function formatBpmRange(min: number, max: number): string {
  return `${min}-${max} bpm`;
}
