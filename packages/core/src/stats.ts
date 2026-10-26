import { addDays, diffDays, startOfWeek, type IsoDate } from './dates';
import type { DistancePoint, StepResult } from './session/track';
import { METERS_PER_MILE } from './units';
import { isHardStep } from './workout';

/**
 * Stats and history math (spec §12). Pure: the repository stores one SessionStats per
 * saved run at finish, and the Stats screen aggregates rows with the functions below.
 */

export const PB_DISTANCES = [
  { key: '1k', meters: 1000, label: '1 km' },
  { key: '1mi', meters: METERS_PER_MILE, label: '1 mi' },
  { key: '5k', meters: 5000, label: '5 km' },
  { key: '10k', meters: 10000, label: '10 km' },
  { key: 'half', meters: 21097.5, label: 'Half marathon' },
] as const;

export interface BestEffort {
  meters: number;
  seconds: number;
  /** Track offset where the effort starts, for highlighting it on the map. */
  startOffsetMs: number;
}

/**
 * Fastest time to cover each distance anywhere in the track (sliding window over the
 * cumulative distance, interpolating the start). Paused time never counts.
 */
export function bestEfforts(
  samples: readonly DistancePoint[],
  pauses: readonly (readonly [number, number])[] = [],
  distances: readonly number[] = PB_DISTANCES.map((d) => d.meters),
): BestEffort[] {
  const active = samples.map((s) => s.tOffsetMs - pauses.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(s.tOffsetMs, b) - a), 0));
  const total = samples.at(-1)?.distanceM ?? 0;
  const out: BestEffort[] = [];
  for (const meters of distances) {
    if (meters > total) continue;
    let best: BestEffort | undefined;
    let i = 0;
    for (let j = 1; j < samples.length; j++) {
      const from = samples[j]!.distanceM - meters;
      if (from < 0) continue;
      while (samples[i + 1]!.distanceM <= from) i++;
      // The window starts between samples i and i + 1.
      const a = samples[i]!;
      const b = samples[i + 1]!;
      const f = b.distanceM === a.distanceM ? 0 : (from - a.distanceM) / (b.distanceM - a.distanceM);
      const startActive = active[i]! + f * (active[i + 1]! - active[i]!);
      const seconds = (active[j]! - startActive) / 1000;
      if (!best || seconds < best.seconds) best = { meters, seconds, startOffsetMs: Math.round(a.tOffsetMs + f * (b.tOffsetMs - a.tOffsetMs)) };
    }
    if (best) out.push({ ...best, seconds: Math.round(best.seconds) });
  }
  return out;
}

/** Stored per saved run (`sessions.stats_json`). */
export interface SessionStats {
  runM: number;
  walkM: number;
  sprintM: number;
  /** Run steps at an easy effort, for the easy pace trend. */
  easyM: number;
  easyS: number;
  bests: BestEffort[];
}

/** Splits a run's distance by step activity. Distance outside any step counts as running. */
export function sessionStats(input: {
  steps: readonly StepResult[];
  distanceM: number;
  samples: readonly DistancePoint[];
  pauses: readonly (readonly [number, number])[];
}): SessionStats {
  const s: SessionStats = { runM: 0, walkM: 0, sprintM: 0, easyM: 0, easyS: 0, bests: bestEfforts(input.samples, input.pauses) };
  for (const r of input.steps) {
    const a = r.step.activity;
    if (a === 'walk' || a === 'rest') s.walkM += r.distanceM;
    else if (a === 'sprint') s.sprintM += r.distanceM;
    else {
      s.runM += r.distanceM;
      if (!isHardStep(r.step)) {
        s.easyM += r.distanceM;
        s.easyS += r.durationS;
      }
    }
  }
  s.runM += Math.max(0, input.distanceM - s.runM - s.walkM - s.sprintM);
  return s;
}

export interface RunRow {
  sessionId: string;
  date: IsoDate;
  distanceM: number;
  durationS: number;
  /** Absent for imported watch sessions, which only have totals. */
  stats?: SessionStats;
  /** Imported walks count as walking distance. */
  walk?: boolean;
}

export interface PeriodTotal {
  /** Monday of the week, or the first of the month. */
  start: IsoDate;
  runs: number;
  distanceM: number;
  durationS: number;
  runM: number;
  walkM: number;
  sprintM: number;
}

const monthStart = (d: IsoDate) => `${d.slice(0, 7)}-01`;
const nextMonth = (d: IsoDate) => {
  const [y, m] = d.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/** Every week or month from start to end, zero-filled, oldest first. */
export function periodTotals(rows: readonly RunRow[], period: 'week' | 'month', start: IsoDate, end: IsoDate): PeriodTotal[] {
  const keyOf = period === 'week' ? startOfWeek : monthStart;
  const buckets = new Map<IsoDate, PeriodTotal>();
  for (let d = keyOf(start); d <= end; d = period === 'week' ? addDays(d, 7) : nextMonth(d)) {
    buckets.set(d, { start: d, runs: 0, distanceM: 0, durationS: 0, runM: 0, walkM: 0, sprintM: 0 });
  }
  for (const r of rows) {
    const b = buckets.get(keyOf(r.date));
    if (!b || r.date < start || r.date > end) continue;
    b.runs++;
    b.distanceM += r.distanceM;
    b.durationS += r.durationS;
    if (r.stats) {
      b.runM += r.stats.runM;
      b.walkM += r.stats.walkM;
      b.sprintM += r.stats.sprintM;
    } else if (r.walk) b.walkM += r.distanceM;
    else b.runM += r.distanceM;
  }
  return [...buckets.values()];
}

/** Weekly average pace of easy running (s/km), only for weeks with at least 1 km of it. */
export function easyPaceTrend(rows: readonly RunRow[], start: IsoDate, end: IsoDate): { start: IsoDate; secPerKm: number }[] {
  const weeks = new Map<IsoDate, { m: number; s: number }>();
  for (const r of rows) {
    if (!r.stats || r.date < start || r.date > end) continue;
    const w = weeks.get(startOfWeek(r.date)) ?? { m: 0, s: 0 };
    w.m += r.stats.easyM;
    w.s += r.stats.easyS;
    weeks.set(startOfWeek(r.date), w);
  }
  return [...weeks]
    .filter(([, w]) => w.m >= 1000)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => ({ start: week, secPerKm: Math.round(w.s / (w.m / 1000)) }));
}

export interface PersonalBest extends BestEffort {
  sessionId: string;
  date: IsoDate;
}

/** Fastest effort per distance across runs; ties keep the earlier run. */
export function personalBests(rows: readonly Pick<RunRow, 'sessionId' | 'date' | 'stats'>[]): PersonalBest[] {
  const best = new Map<number, PersonalBest>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const e of r.stats?.bests ?? []) {
      const cur = best.get(e.meters);
      if (!cur || e.seconds < cur.seconds) best.set(e.meters, { ...e, sessionId: r.sessionId, date: r.date });
    }
  }
  return PB_DISTANCES.flatMap((d) => best.get(d.meters) ?? []);
}

/**
 * Consecutive weeks with at least `minPerWeek` runs, ending this week. This week counts
 * once it reaches the minimum; until then the streak runs to last week.
 */
export function weekStreak(dates: readonly IsoDate[], minPerWeek: number, today: IsoDate): number {
  const counts = new Map<IsoDate, number>();
  for (const d of dates) counts.set(startOfWeek(d), (counts.get(startOfWeek(d)) ?? 0) + 1);
  let week = startOfWeek(today);
  if ((counts.get(week) ?? 0) < minPerWeek) week = addDays(week, -7);
  let n = 0;
  while ((counts.get(week) ?? 0) >= minPerWeek) {
    n++;
    week = addDays(week, -7);
  }
  return n;
}

/** Consecutive days with an entry, ending today (or yesterday when today has none yet). */
export function dayStreak(dates: readonly IsoDate[], today: IsoDate): number {
  const set = new Set(dates);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export interface WeekAdherence {
  start: IsoDate;
  done: number;
  /** Planned items that are done or past (skipped and missed count against). */
  total: number;
  /** 0..1, undefined for a week with nothing due yet. */
  rate?: number;
}

/** Plan adherence by week. Items still ahead of today are not due, so they don't count. */
export function adherenceByWeek(items: readonly { date: IsoDate; status: string }[], today: IsoDate): WeekAdherence[] {
  const weeks = new Map<IsoDate, WeekAdherence>();
  for (const i of items) {
    const key = startOfWeek(i.date);
    const w = weeks.get(key) ?? { start: key, done: 0, total: 0 };
    weeks.set(key, w);
    if (i.status === 'done') {
      w.done++;
      w.total++;
    } else if (i.status !== 'moved' && (i.status === 'skipped' || i.status === 'missed' || diffDays(i.date, today) > 0)) w.total++;
  }
  return [...weeks.values()]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((w) => ({ ...w, rate: w.total > 0 ? w.done / w.total : undefined }));
}

/** Distinct days per week with an entry, for "Morning: 5 of 7 this week" style counts. */
export function daysInWeek(dates: readonly IsoDate[], weekStart: IsoDate): number {
  const end = addDays(weekStart, 6);
  return new Set(dates.filter((d) => d >= weekStart && d <= end)).size;
}
