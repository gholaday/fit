/**
 * Treadmill speed in the display unit. Storage is km/h; miles users see mph, and the
 * +/- buttons step in mph so they match the belt's display.
 */
import { type DistanceUnit, METERS_PER_MILE } from '@fit/core';

const KPH_PER_MPH = METERS_PER_MILE / 1000;

export const speedUnit = (unit: DistanceUnit) => (unit === 'mi' ? 'mph' : 'km/h');

export function kphToUnit(kph: number, unit: DistanceUnit): number {
  return Math.round((unit === 'mi' ? kph / KPH_PER_MPH : kph) * 10) / 10;
}

export function unitToKph(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * KPH_PER_MPH : value;
}

/** "6.0 mph" or "9.7 km/h". */
export const formatSpeed = (kph: number, unit: DistanceUnit) => `${kphToUnit(kph, unit).toFixed(1)} ${speedUnit(unit)}`;

/** The speed after a +/- press of `delta` in the display unit, back in km/h. */
export const nudgeKph = (kph: number, delta: number, unit: DistanceUnit) => unitToKph(Math.max(0, kphToUnit(kph, unit) + delta), unit);
