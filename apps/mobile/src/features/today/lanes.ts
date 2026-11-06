import { type AgendaItem, type Lane, type UnitPrefs, formatDistance, formatMinutes } from '@fit/core';
import { clockTime } from '@/lib/format';

export const LANE_NAME: Record<Lane, string> = { run: 'Run', workout: 'Workout', stretch: 'Stretch' };

/** Time for a pending item, the result once done, or "Skipped". */
export function itemDetail(i: AgendaItem, units: UnitPrefs): string {
  if (i.status === 'skipped') return 'Skipped';
  if (i.status === 'done') {
    const d = i.details;
    const parts = [d?.distanceM ? formatDistance(d.distanceM, units.distance, 2) : undefined, d?.minutes ? formatMinutes(d.minutes * 60) : undefined].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'Done';
  }
  return i.time ? clockTime(i.time) : formatMinutes(i.estSeconds);
}

/** A lane card's status: the one item's result or time, or "1 of 2" for a lane with several. */
export function laneStatus(items: readonly AgendaItem[], units: UnitPrefs): string {
  if (items.length === 1) return itemDetail(items[0]!, units);
  return `${items.filter((i) => i.status === 'done').length} of ${items.length}`;
}

/** "Tomorrow: Long run" from the main items, or "Tomorrow: rest day". */
export function tomorrowLine(tomorrow: readonly AgendaItem[]): string {
  const main = tomorrow.filter((i) => i.lane !== 'stretch').map((i) => i.title);
  return main.length > 0 ? `Tomorrow: ${main.join(', ')}` : 'Tomorrow: rest day';
}
