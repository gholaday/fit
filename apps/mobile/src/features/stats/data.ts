/**
 * Everything the Stats screen shows for one period, read synchronously from the repository
 * and shaped with the @fit/core stats math. Recomputed when the data version changes.
 */
import {
  type AerobicTest,
  type AgendaItem,
  type DailyMetrics,
  type IsoDate,
  type PersonalBest,
  type RunRow,
  type RunSplit,
  type WeekAdherence,
  addDays,
  adherenceByWeek,
  daysInWeek,
  decouplingTrend,
  easyPaceTrend,
  periodTotals,
  personalBests,
  runShareTrend,
  runSplit,
  startOfWeek,
  weekStreak,
  zone2MinutesByWeek,
  zone2PaceTrend,
} from '@fit/core';
import { repo } from '@/data';

export type Period = 'week' | 'month' | '3m';

export interface Range {
  start: IsoDate;
  end: IsoDate;
}

const pad = (n: number) => String(n).padStart(2, '0');

function monthStart(d: IsoDate, offset: number): IsoDate {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + offset;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}-01`;
}

/** The period containing today, moved `offset` periods back (negative) or forward. */
export function rangeFor(period: Period, today: IsoDate, offset: number): Range {
  if (period === 'week') {
    const start = addDays(startOfWeek(today), offset * 7);
    return { start, end: addDays(start, 6) };
  }
  if (period === 'month') {
    const start = monthStart(today, offset);
    return { start, end: addDays(monthStart(start, 1), -1) };
  }
  // 13 weeks ending with this week.
  const end = addDays(startOfWeek(today), 6 + offset * 91);
  return { start: addDays(end, -90), end };
}

export interface Bucket extends RunSplit {
  start: IsoDate;
  distanceM: number;
  durationS: number;
}

export interface Completion {
  lane: AgendaItem['lane'];
  name: string;
  done: number;
  total: number;
}

export interface StatsData {
  range: Range;
  rows: RunRow[];
  buckets: Bucket[];
  /** Day buckets for a week, week buckets otherwise. */
  bucketUnit: 'day' | 'week';
  easyTrend: { start: IsoDate; secPerKm: number }[];
  bests: PersonalBest[];
  longest?: RunRow;
  streak: number;
  completion: Completion[];
  adherence: WeekAdherence[];
  strengthWeeks: { start: IsoDate; count: number }[];
  stretchWeeks: { start: IsoDate; minutes: number }[];
  stretchThisWeek: { name: string; days: number }[];
  metrics: DailyMetrics[];
  restingHr: { date: IsoDate; bpm: number }[];
  heart: HeartProgress;
}

/** Heart rate progress (spec §7 Progress), over the same 12 weeks as easy pace. */
export interface HeartProgress {
  z2Pace: { start: IsoDate; secPerKm: number }[];
  /** Eight weeks, zero-filled. */
  z2Minutes: { start: IsoDate; minutes: number }[];
  /** Weekly Zone 2 minutes the active Zone 2 plan asks for this week. */
  z2Target?: number;
  runShare: { start: IsoDate; runShare: number }[];
  decoupling: { sessionId: string; date: IsoDate; pct: number }[];
  tests: AerobicTest[];
  /** True when any of the above has data. */
  any: boolean;
}

/** Eight weeks ending with the range's last week, for the per-week charts. */
function weeksBack(end: IsoDate, n = 8): IsoDate[] {
  const last = startOfWeek(end);
  return Array.from({ length: n }, (_, i) => addDays(last, (i - n + 1) * 7));
}

/** Due counts: done, plus skipped, missed and past pending ones. Future items do not count. */
function due(items: readonly AgendaItem[], today: IsoDate): { done: number; total: number } {
  return adherenceByWeek(items, today).reduce((sum, w) => ({ done: sum.done + w.done, total: sum.total + w.total }), { done: 0, total: 0 });
}

const isPlanRun = (i: AgendaItem) => i.lane === 'run' && i.source.type === 'plan_workout';

export function loadStats(period: Period, offset: number, today: IsoDate): StatsData {
  const range = rangeFor(period, today, offset);
  const all = repo.runRows('2000-01-01', today);
  const rows = all.filter((r) => r.date >= range.start && r.date <= range.end);

  let buckets: Bucket[];
  if (period === 'week') {
    buckets = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(range.start, i);
      const dayRows = rows.filter((r) => r.date === day);
      return { start: day, distanceM: dayRows.reduce((t, r) => t + r.distanceM, 0), durationS: dayRows.reduce((t, r) => t + r.durationS, 0), ...runSplit(dayRows) };
    });
  } else {
    buckets = periodTotals(rows, 'week', range.start, range.end).map(({ start, distanceM, durationS, runM, walkM, sprintM }) => ({ start, distanceM, durationS, runM, walkM, sprintM }));
  }

  const trendStart = addDays(startOfWeek(range.end), -7 * 11);
  const easyTrend = easyPaceTrend(all, trendStart, range.end);
  const longest = all.reduce<RunRow | undefined>((best, r) => (!r.walk && (!best || r.distanceM > best.distanceM) ? r : best), undefined);
  const streak = weekStreak(
    all.filter((r) => !r.walk).map((r) => r.date),
    3,
    today,
  );

  // Completion in the range: the running plan, workouts, then each stretch routine.
  const items = repo.agenda(range.start, range.end);
  const completion: Completion[] = [];
  const planRuns = due(items.filter(isPlanRun), today);
  if (planRuns.total > 0) completion.push({ lane: 'run', name: 'Running plan', ...planRuns });
  const workouts = due(
    items.filter((i) => i.lane === 'workout'),
    today,
  );
  if (workouts.total > 0) completion.push({ lane: 'workout', name: 'Workouts', ...workouts });
  const byRoutine = new Map<string, AgendaItem[]>();
  for (const i of items) if (i.lane === 'stretch') byRoutine.set(i.refId, [...(byRoutine.get(i.refId) ?? []), i]);
  for (const list of byRoutine.values()) {
    const d = due(list, today);
    if (d.total > 0) completion.push({ lane: 'stretch', name: list[0]!.title, ...d });
  }

  const weeks = weeksBack(range.end);
  const wStart = weeks[0]!;
  const wEnd = addDays(weeks[weeks.length - 1]!, 6);
  const adherenceMap = new Map(adherenceByWeek(repo.agenda(wStart, wEnd).filter(isPlanRun), today).map((w) => [w.start, w]));
  const adherence = weeks.map((start) => adherenceMap.get(start) ?? { start, done: 0, total: 0 });

  const strength = repo.strengthDays(wStart, wEnd);
  const strengthWeeks = weeks.map((start) => ({ start, count: strength.filter((d) => startOfWeek(d.date) === start).length }));

  const routines = repo.routines();
  const estMin = (id: string) => Math.round((routines.find((r) => r.id === id)?.estSeconds ?? 0) / 60);
  const stretchDays = repo.routineDays(wStart, wEnd).filter((d) => routines.find((r) => r.id === d.routineId)?.kind === 'stretch');
  const stretchWeeks = weeks.map((start) => ({
    start,
    minutes: stretchDays.filter((d) => startOfWeek(d.date) === start).reduce((t, d) => t + (d.minutes ?? estMin(d.routineId)), 0),
  }));
  const lastWeek = weeks[weeks.length - 1]!;
  const names = new Map(routines.map((r) => [r.id, r.name]));
  const stretchThisWeek = [...new Set(stretchDays.map((d) => d.routineId))]
    .map((id) => ({ name: names.get(id) ?? 'Stretch', days: daysInWeek(stretchDays.filter((d) => d.routineId === id).map((d) => d.date), lastWeek) }))
    .filter((r) => r.days > 0);

  const metrics = repo.dailyMetricsRange(range.start, range.end);
  const restingHr = repo
    .dailyMetricsRange(addDays(range.end, -89), range.end)
    .flatMap((m) => (m.restingHr ? [{ date: m.date, bpm: m.restingHr }] : []))
    .sort((a, b) => a.date.localeCompare(b.date));

  const plan = repo.activePlan(today);
  const heart: HeartProgress = {
    z2Pace: zone2PaceTrend(all, trendStart, range.end),
    z2Minutes: zone2MinutesByWeek(all, wStart, wEnd),
    z2Target: plan?.measure.kind === 'z2_minutes' && plan.measure.planned > 0 ? Math.round(plan.measure.planned) : undefined,
    runShare: runShareTrend(all, trendStart, range.end),
    decoupling: decouplingTrend(all.filter((r) => r.date <= range.end)).slice(-5),
    tests: repo.aerobicTests().filter((t) => t.date <= range.end),
    any: false,
  };
  heart.any = heart.z2Pace.length > 0 || heart.z2Minutes.some((w) => w.minutes > 0) || heart.runShare.length > 0 || heart.decoupling.length > 0 || heart.tests.length > 0;

  return {
    range,
    rows,
    buckets,
    bucketUnit: period === 'week' ? 'day' : 'week',
    easyTrend,
    // Treadmill and watch rows carry no bests, so every row can go in.
    bests: personalBests(all),
    longest,
    streak,
    completion,
    adherence,
    strengthWeeks,
    stretchWeeks,
    stretchThisWeek,
    metrics,
    restingHr,
    heart,
  };
}
