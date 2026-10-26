import { type AgendaItem, type IsoDate, type Routine, type UnitPrefs, diffDays, formatDistance, formatMinutes, startOfWeek, weekdayOf } from '@fit/core';
import { clockTime, shortDate, weekdayLong } from '@/lib/format';

export function routineOf(item: AgendaItem, routines: readonly Routine[]): Routine | undefined {
  return item.source.type === 'schedule' ? routines.find((r) => r.id === item.refId) : undefined;
}

/** "5 exercises, about 50 min", "6 moves, 8 min", "35 min, 2.9 mi" */
export function itemSubtitle(item: AgendaItem, routines: readonly Routine[], units: UnitPrefs): string {
  const r = routineOf(item, routines);
  if (item.lane === 'workout') {
    const n = r?.itemCount;
    return n ? `${n} exercises, about ${formatMinutes(item.estSeconds)}` : `About ${formatMinutes(item.estSeconds)}`;
  }
  if (item.lane === 'stretch') {
    const n = r?.itemCount;
    return n ? `${n} moves, ${formatMinutes(item.estSeconds)}` : formatMinutes(item.estSeconds);
  }
  const parts = [formatMinutes(item.estSeconds)];
  if (item.estMeters) parts.push(formatDistance(item.estMeters, units.distance));
  return parts.join(', ');
}

/** Short cell meta for the Plan grid: "35 min", "6 exercises", "Done". */
export function cellMeta(item: AgendaItem, routines: readonly Routine[]): string {
  if (item.status === 'done') return 'Done';
  if (item.status === 'skipped') return item.missed ? 'Missed' : 'Skipped';
  if (item.lane === 'workout') {
    const n = routineOf(item, routines)?.itemCount;
    return n ? `${n} exercises` : formatMinutes(item.estSeconds);
  }
  if (item.time) return clockTime(item.time);
  return formatMinutes(item.estSeconds);
}

/** "Saturday" this week, "Sat, Nov 7" otherwise. */
export function dayName(date: IsoDate, today: IsoDate): string {
  const sameWeek = startOfWeek(date) === startOfWeek(today);
  return sameWeek ? weekdayLong(weekdayOf(date)) : shortDate(date);
}

/** "Planned for Thu, Oct 29" or "Moved from Tue, Oct 27". */
export function plannedLine(item: AgendaItem): string {
  if (item.date !== item.originalDate) return `Moved from ${shortDate(item.originalDate)}`;
  return `Planned for ${shortDate(item.date)}`;
}

export function isPast(date: IsoDate, today: IsoDate): boolean {
  return diffDays(today, date) < 0;
}
