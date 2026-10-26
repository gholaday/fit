import { type AgendaItem, type Lane, type UnitPrefs, formatDistance, formatMinutes } from '@fit/core';
import { clockTime } from '@/lib/format';

/** What the day widget says (spec §14 Today day widget). Presentation only. */
export type WidgetState = 'empty' | 'rest' | 'morning' | 'day' | 'evening';

export interface DaySummary {
  state: WidgetState;
  headline: string;
  /** First line, with the lane whose icon leads it. */
  line?: { lane: Lane; text: string };
  /** Second, quieter line. */
  sub?: { icon: 'clock' | 'calendar'; text: string };
  done: number;
  total: number;
  segments: { lane: Lane; status: AgendaItem['status'] }[];
}

const EVENING_HOUR = 20;
const MORNING_UNTIL = 12;

export function summarizeDay(items: readonly AgendaItem[], tomorrow: readonly AgendaItem[], hour: number, units: UnitPrefs): DaySummary {
  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const resolved = items.filter((i) => i.status !== 'pending').length;
  const segments = items.map((i) => ({ lane: i.lane, status: i.status }));
  const next = items.find((i) => i.status === 'pending');
  const base = { done, total, segments };

  if (total === 0) return { ...base, state: 'empty', headline: 'Rest day', sub: { icon: 'calendar', text: tomorrowLine(tomorrow) } };

  const restDay = items.every((i) => i.lane === 'stretch');
  if (restDay && resolved < total) {
    return {
      ...base,
      state: 'rest',
      headline: `Rest day, ${done} of ${total} done`,
      line: next ? { lane: next.lane, text: next.time ? `${next.title} at ${clockTime(next.time)}` : next.title } : undefined,
    };
  }

  if (resolved === total || hour >= EVENING_HOUR) {
    const highlight = items.find((i) => i.lane === 'run' && i.status === 'done') ?? items.find((i) => i.status === 'done');
    return {
      ...base,
      state: 'evening',
      headline: done === total ? 'All done' : `${done} of ${total} done`,
      line: highlight ? { lane: highlight.lane, text: highlightText(highlight, units) } : undefined,
      sub: { icon: 'calendar', text: tomorrowLine(tomorrow) },
    };
  }

  if (resolved === 0 && hour < MORNING_UNTIL) {
    const first = items[0]!;
    const totalSeconds = items.reduce((s, i) => s + i.estSeconds, 0);
    return {
      ...base,
      state: 'morning',
      headline: total === 1 ? '1 thing today' : `${total} things today`,
      line: { lane: first.lane, text: `First: ${first.title}, ${first.time ? clockTime(first.time) : formatMinutes(first.estSeconds)}` },
      sub: { icon: 'clock', text: `About ${formatMinutes(totalSeconds)} in total` },
    };
  }

  return {
    ...base,
    state: 'day',
    headline: `${done} of ${total} done`,
    line: next ? { lane: next.lane, text: `Next: ${next.title}, ${next.time ? clockTime(next.time) : formatMinutes(next.estSeconds)}` } : undefined,
  };
}

function highlightText(item: AgendaItem, units: UnitPrefs): string {
  const parts = [item.title];
  const d = item.details;
  if (d?.distanceM) parts.push(formatDistance(d.distanceM, units.distance, 2));
  if (d?.minutes) parts.push(formatMinutes(d.minutes * 60));
  else if (!d?.distanceM) parts.push(formatMinutes(item.estSeconds));
  return parts.join(', ');
}

function tomorrowLine(tomorrow: readonly AgendaItem[]): string {
  const main = tomorrow.filter((i) => i.lane !== 'stretch').map((i) => i.title);
  return main.length > 0 ? `Tomorrow: ${main.join(', ')}` : 'Tomorrow: rest day';
}
