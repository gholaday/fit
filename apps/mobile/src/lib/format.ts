/**
 * Display formatting for dates and times. IsoDate values are calendar dates, so all
 * formatting reads them in UTC (same convention as @fit/core dates.ts).
 */
import { type IsoDate, type Weekday, weekdayOf } from '@fit/core';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function parts(date: IsoDate): { m: number; d: number } {
  const [, m, d] = date.split('-').map(Number);
  return { m: (m ?? 1) - 1, d: d ?? 1 };
}

export function weekdayLong(w: Weekday): string {
  return DOW_LONG[w - 1]!;
}
export function weekdayShort(w: Weekday): string {
  return DOW_SHORT[w - 1]!;
}
export function weekdayLetter(w: Weekday): string {
  return DOW_LETTER[w - 1]!;
}

/** "Oct 27" */
export function monthDay(date: IsoDate): string {
  const { m, d } = parts(date);
  return `${MONTHS[m]} ${d}`;
}

/** "27" */
export function dayOfMonth(date: IsoDate): string {
  return String(parts(date).d);
}

/** "Tuesday, Oct 27" */
export function longDate(date: IsoDate): string {
  return `${weekdayLong(weekdayOf(date))}, ${monthDay(date)}`;
}

/** "Thu, Oct 29" */
export function shortDate(date: IsoDate): string {
  return `${weekdayShort(weekdayOf(date))}, ${monthDay(date)}`;
}

/** "Oct 26 to Nov 1" */
export function dateRangeLabel(start: IsoDate, end: IsoDate): string {
  return `${monthDay(start)} to ${monthDay(end)}`;
}

/** "07:00" to "7:00 AM" */
export function clockTime(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(':').map(Number);
  const h = hRaw ?? 0;
  const m = mRaw ?? 0;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Minutes since midnight to "07:00". */
export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function minutesOf(hhmmValue: string): number {
  const [h, m] = hhmmValue.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "8,000" */
export function thousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "25:30" from seconds, for goal times. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Parses "25:30" or "25" to seconds. */
export function parseMmss(text: string): number | undefined {
  const m = /^\s*(\d{1,3})(?::(\d{1,2}))?\s*$/.exec(text);
  if (!m) return undefined;
  const min = Number(m[1]);
  const sec = m[2] ? Number(m[2]) : 0;
  if (sec >= 60) return undefined;
  return min * 60 + sec;
}

/** "Morning, Evening" style list joins with commas only (copy rules). */
export function list(items: readonly string[]): string {
  return items.join(', ');
}
