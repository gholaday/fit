import { addDays, diffDays, startOfWeek, type IsoDate } from './dates';
import { zoneBand, type HrZoneBand } from './hr';
import { hrAt, hrStats, type HrSample } from './session/heart';
import type { RunWalkSegment, StepLogEntry } from './session/player';
import { runWalkTotals } from './session/runwalk';
import type { DistancePoint, StepResult } from './session/track';
import { METERS_PER_MILE } from './units';
import { isHardStep, type SessionMode, type Step } from './workout';

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

/** Bump when SessionStats gains fields, so stored stats are recomputed on first use. */
export const SESSION_STATS_VERSION = 3;

/** Stored per saved run (`sessions.stats_json`). */
export interface SessionStats {
  v: number;
  runM: number;
  walkM: number;
  sprintM: number;
  /** Run steps at an easy effort, for the easy pace trend. */
  easyM: number;
  easyS: number;
  bests: BestEffort[];
  /** Longest stretch of running without a walk, active seconds (records). */
  nonstopS: number;
  /** With HR (live or Health Connect): seconds in Zone 2, any mode. */
  z2S?: number;
  /** Outdoor distance and time covered while in Zone 2, for the pace at Zone 2 trend. */
  z2PaceM?: number;
  z2PaceS?: number;
  /** Aerobic decoupling (Pa:HR) of the main steady step, when it ran 40 min or more. */
  decouplingPct?: number;
  /** HR-driven run/walk steps. */
  runWalk?: { runS: number; walkS: number };
}

export interface SessionStatsInput {
  steps: readonly StepResult[];
  distanceM: number;
  samples: readonly DistancePoint[];
  pauses: readonly (readonly [number, number])[];
  log?: readonly StepLogEntry[];
  runWalk?: readonly RunWalkSegment[];
  hr?: readonly Pick<HrSample, 'tOffsetMs' | 'bpm'>[];
  zones?: readonly HrZoneBand[];
  endMs?: number;
}

/** Splits a run's distance by step activity (run/walk phases by phase). Distance outside any step counts as running. */
export function sessionStats(input: SessionStatsInput): SessionStats {
  const s: SessionStats = {
    v: SESSION_STATS_VERSION,
    runM: 0,
    walkM: 0,
    sprintM: 0,
    easyM: 0,
    easyS: 0,
    bests: bestEfforts(input.samples, input.pauses),
    nonstopS: input.log ? longestNonstopS(input.log.map((e, i) => ({ ...e, step: input.steps[i]?.step })), input.runWalk) : 0,
  };
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
  // Walk phases of run/walk steps are walking, not easy running.
  for (const g of input.runWalk ?? []) {
    if (g.phase !== 'walk') continue;
    const m = Math.max(0, g.endDistanceM - g.startDistanceM);
    s.runM -= m;
    s.walkM += m;
    s.easyM = Math.max(0, s.easyM - m);
    s.easyS = Math.max(0, s.easyS - (g.endActiveMs - g.startActiveMs) / 1000);
  }
  s.runM = Math.max(0, s.runM) + Math.max(0, input.distanceM - s.runM - s.walkM - s.sprintM);
  if (input.runWalk?.length) {
    const t = runWalkTotals(input.runWalk);
    s.runWalk = { runS: t.runS, walkS: t.walkS };
  }

  const hr = input.hr ?? [];
  const zones = input.zones ?? [];
  if (hr.length > 0 && zones.length > 0) {
    const stats = hrStats(hr as HrSample[], zones, { endMs: input.endMs ?? hr.at(-1)!.tOffsetMs, pauses: input.pauses });
    if (stats) s.z2S = stats.zoneSeconds[1];
    const z2 = zoneBand(zones, 2);
    const pace = distanceInRange(input.samples, hr, z2.minBpm, z2.maxBpm, input.pauses);
    if (pace.s > 0) {
      s.z2PaceM = pace.m;
      s.z2PaceS = pace.s;
    }
    const d = input.log ? mainStepDecoupling(input.steps, input.log, input.samples, hr) : undefined;
    if (d !== undefined) s.decouplingPct = d;
  }
  return s;
}

/**
 * Longest stretch of running without a walk: contiguous run and sprint steps, broken by
 * walk or rest steps and by the walk phases of HR run/walk steps. Active seconds.
 */
export function longestNonstopS(
  entries: readonly (Pick<StepLogEntry, 'startActiveMs' | 'endActiveMs'> & { step?: Step })[],
  runWalk: readonly RunWalkSegment[] = [],
): number {
  const runs: [number, number][] = [];
  for (const e of entries) {
    if (e.step?.activity !== 'run' && e.step?.activity !== 'sprint') continue;
    const last = runs.at(-1);
    if (last && last[1] === e.startActiveMs) last[1] = e.endActiveMs;
    else runs.push([e.startActiveMs, e.endActiveMs]);
  }
  let pieces = runs;
  for (const w of runWalk.filter((g) => g.phase === 'walk')) {
    pieces = pieces.flatMap(([a, b]): [number, number][] => {
      if (w.endActiveMs <= a || w.startActiveMs >= b) return [[a, b]];
      const out: [number, number][] = [];
      if (w.startActiveMs > a) out.push([a, w.startActiveMs]);
      if (w.endActiveMs < b) out.push([w.endActiveMs, b]);
      return out;
    });
  }
  return Math.round(Math.max(0, ...pieces.map(([a, b]) => b - a)) / 1000);
}

/** Distance and seconds covered while HR was within [minBpm, maxBpm]. Gaps over 10 s and paused time are skipped. */
export function distanceInRange(
  samples: readonly DistancePoint[],
  hr: readonly Pick<HrSample, 'tOffsetMs' | 'bpm'>[],
  minBpm: number,
  maxBpm: number,
  pauses: readonly (readonly [number, number])[] = [],
): { m: number; s: number } {
  let m = 0;
  let ms = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const dt = b.tOffsetMs - a.tOffsetMs;
    if (dt <= 0 || dt > 10_000 || pauses.some(([p, q]) => a.tOffsetMs >= p && a.tOffsetMs < q)) continue;
    const bpm = hrAt(hr, a.tOffsetMs);
    if (bpm === undefined || bpm < minBpm || bpm > maxBpm) continue;
    m += b.distanceM - a.distanceM;
    ms += dt;
  }
  return { m: Math.round(m), s: Math.round(ms / 1000) };
}

export const DECOUPLING_MIN_MS = 40 * 60_000;

/**
 * Pa:HR decoupling (spec §7): speed per beat in the first half against the second half
 * of a window. Positive means HR drifted up for the same pace; under 5% is good.
 */
export function decoupling(samples: readonly DistancePoint[], hr: readonly Pick<HrSample, 'tOffsetMs' | 'bpm'>[], fromMs: number, toMs: number): number | undefined {
  if (toMs - fromMs < DECOUPLING_MIN_MS) return undefined;
  const mid = (fromMs + toMs) / 2;
  const half = (a: number, b: number) => {
    const m = distanceAt(samples, b) - distanceAt(samples, a);
    const beats = hr.filter((h) => h.tOffsetMs >= a && h.tOffsetMs < b);
    if (m <= 0 || beats.length === 0) return undefined;
    const avg = beats.reduce((sum, h) => sum + h.bpm, 0) / beats.length;
    return m / ((b - a) / 1000) / avg;
  };
  const first = half(fromMs, mid);
  const second = half(mid, toMs);
  if (first === undefined || second === undefined) return undefined;
  return Math.round(((first - second) / first) * 1000) / 10;
}

function distanceAt(samples: readonly DistancePoint[], t: number): number {
  let prev: DistancePoint | undefined;
  for (const s of samples) {
    if (s.tOffsetMs >= t) {
      if (!prev || s.tOffsetMs === prev.tOffsetMs) return s.distanceM;
      return prev.distanceM + ((t - prev.tOffsetMs) / (s.tOffsetMs - prev.tOffsetMs)) * (s.distanceM - prev.distanceM);
    }
    prev = s;
  }
  return prev?.distanceM ?? 0;
}

/** Decoupling over the longest easy run step (the steady part, without warm up and cool down). */
function mainStepDecoupling(
  steps: readonly StepResult[],
  log: readonly StepLogEntry[],
  samples: readonly DistancePoint[],
  hr: readonly Pick<HrSample, 'tOffsetMs' | 'bpm'>[],
): number | undefined {
  let best: StepLogEntry | undefined;
  log.forEach((e, i) => {
    const step = steps[i]?.step;
    if (!step || step.activity !== 'run' || isHardStep(step) || e.skipped) return;
    if (!best || e.endOffsetMs - e.startOffsetMs > best.endOffsetMs - best.startOffsetMs) best = e;
  });
  return best ? decoupling(samples, hr, best.startOffsetMs, best.endOffsetMs) : undefined;
}

export interface RunRow {
  sessionId: string;
  /** Recorded in Fit, or a saved watch activity. */
  source: 'fit' | 'external';
  /** Fit sessions, and watch treadmill runs. */
  mode?: SessionMode;
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
    addSplit(b, r);
  }
  return [...buckets.values()];
}

export interface RunSplit {
  runM: number;
  walkM: number;
  sprintM: number;
}

/** Imported sessions have no steps: a walk counts as walking, anything else as running. */
function addSplit(to: RunSplit, r: RunRow): void {
  if (r.stats) {
    to.runM += r.stats.runM;
    to.walkM += r.stats.walkM;
    to.sprintM += r.stats.sprintM;
  } else if (r.walk) to.walkM += r.distanceM;
  else to.runM += r.distanceM;
}

/** Run, walk and sprint distance across rows, split the same way periodTotals splits a period. */
export function runSplit(rows: readonly RunRow[]): RunSplit {
  const s: RunSplit = { runM: 0, walkM: 0, sprintM: 0 };
  for (const r of rows) addSplit(s, r);
  return s;
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

/** Groups rows with stats by week, oldest first. */
function byWeek(rows: readonly RunRow[], start: IsoDate, end: IsoDate): [IsoDate, SessionStats[]][] {
  const weeks = new Map<IsoDate, SessionStats[]>();
  for (const r of rows) {
    if (!r.stats || r.date < start || r.date > end) continue;
    const key = startOfWeek(r.date);
    weeks.set(key, [...(weeks.get(key) ?? []), r.stats]);
  }
  return [...weeks].sort(([a], [b]) => a.localeCompare(b));
}

/** The headline Zone 2 metric (spec §7 Progress): weekly pace while in Zone 2, for weeks with 10 min or more of it. */
export function zone2PaceTrend(rows: readonly RunRow[], start: IsoDate, end: IsoDate): { start: IsoDate; secPerKm: number }[] {
  return byWeek(rows, start, end).flatMap(([week, list]) => {
    const m = list.reduce((sum, s) => sum + (s.z2PaceM ?? 0), 0);
    const sec = list.reduce((sum, s) => sum + (s.z2PaceS ?? 0), 0);
    return sec >= 600 && m > 0 ? [{ start: week, secPerKm: Math.round(sec / (m / 1000)) }] : [];
  });
}

/** Minutes in Zone 2 per week, zero-filled, against the plan's weekly target. */
export function zone2MinutesByWeek(rows: readonly RunRow[], start: IsoDate, end: IsoDate): { start: IsoDate; minutes: number }[] {
  const found = new Map(byWeek(rows, start, end).map(([w, list]) => [w, list.reduce((sum, s) => sum + (s.z2S ?? 0), 0)]));
  const out: { start: IsoDate; minutes: number }[] = [];
  for (let w = startOfWeek(start); w <= end; w = addDays(w, 7)) out.push({ start: w, minutes: Math.round((found.get(w) ?? 0) / 60) });
  return out;
}

/** Share of run/walk time spent running, per week (more running at the same HR is progress). */
export function runShareTrend(rows: readonly RunRow[], start: IsoDate, end: IsoDate): { start: IsoDate; runShare: number }[] {
  return byWeek(rows, start, end).flatMap(([week, list]) => {
    const run = list.reduce((sum, s) => sum + (s.runWalk?.runS ?? 0), 0);
    const walk = list.reduce((sum, s) => sum + (s.runWalk?.walkS ?? 0), 0);
    return run + walk > 0 ? [{ start: week, runShare: Math.round((run / (run + walk)) * 100) / 100 }] : [];
  });
}

/** Decoupling of each long steady session, oldest first. */
export function decouplingTrend(rows: readonly RunRow[]): { sessionId: string; date: IsoDate; pct: number }[] {
  return rows.flatMap((r) => (r.stats?.decouplingPct !== undefined ? [{ sessionId: r.sessionId, date: r.date, pct: r.stats.decouplingPct }] : []));
}

/**
 * Learned Zone 2 pace (spec §7 fallback): the median pace in Zone 2 over the last six runs
 * with 10 min or more of it. Needs three such runs.
 */
export function learnedZone2Pace(rows: readonly RunRow[]): number | undefined {
  const paces = rows
    .filter((r) => (r.stats?.z2PaceS ?? 0) >= 600 && (r.stats?.z2PaceM ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-6)
    .map((r) => r.stats!.z2PaceS! / (r.stats!.z2PaceM! / 1000))
    .sort((a, b) => a - b);
  if (paces.length < 3) return undefined;
  const mid = paces.length / 2;
  return Math.round(paces.length % 2 ? paces[Math.floor(mid)]! : (paces[mid - 1]! + paces[mid]!) / 2);
}

/** Distinct days per week with an entry, for "Morning: 5 of 7 this week" style counts. */
export function daysInWeek(dates: readonly IsoDate[], weekStart: IsoDate): number {
  const end = addDays(weekStart, 6);
  return new Set(dates.filter((d) => d >= weekStart && d <= end)).size;
}
