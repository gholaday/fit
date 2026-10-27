/**
 * Weight display (spec §12 Weight). Stored in kg; shown in the units setting with one
 * decimal, since the trend moves by tenths.
 */
import { type GoalProgress, type IsoDate, type WeightUnit, addDays, kgToUnit, localIsoDate } from '@fit/core';
import { monthDay } from '@/lib/format';

/** "182.4 lb" */
export function weightLabel(kg: number, unit: WeightUnit): string {
  return `${kgToUnit(kg, unit).toFixed(1)} ${unit}`;
}

/** "Down 3.2 lb", "Up 0.4 lb", "No change" */
export function changeLabel(kg: number, unit: WeightUnit): string {
  const v = kgToUnit(Math.abs(kg), unit);
  if (v < 0.05) return 'No change';
  return `${kg < 0 ? 'Down' : 'Up'} ${v.toFixed(1)} ${unit}`;
}

/** "1 lb a week", "0.25 kg a week" */
export function paceLabel(kgWeek: number, unit: WeightUnit): string {
  return `${Number(kgToUnit(Math.abs(kgWeek), unit).toFixed(2))} ${unit} a week`;
}

/** "Down 0.9 lb a week", "Up 0.2 kg a week" */
export function rateLabel(kgWeek: number, unit: WeightUnit): string {
  return `${changeLabel(kgWeek, unit)} a week`;
}

/** "On track", "1.2 lb ahead", "1.2 lb behind", "Goal reached" */
export function statusLabel(progress: GoalProgress, unit: WeightUnit): string {
  if (progress.status === 'reached') return 'Goal reached';
  if (progress.status === 'on_track') return 'On track';
  return `${kgToUnit(Math.abs(progress.aheadKg), unit).toFixed(1)} ${unit} ${progress.status}`;
}

/** "7:10 AM" */
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "today 7:10 AM", "yesterday 7:10 AM", "Oct 24 7:10 AM" */
export function whenLabel(iso: string, today: IsoDate): string {
  const date = localIsoDate(new Date(iso));
  const day = date === today ? 'today' : date === addDays(today, -1) ? 'yesterday' : monthDay(date);
  return `${day} ${timeOfDay(iso)}`;
}
