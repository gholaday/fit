import { addDays, diffDays, type IsoDate } from './dates';
import { type WeightUnit, unitToKg } from './units';

/**
 * Weight tracking (spec §12 Weight). Every number the app shows for weight is the smoothed
 * trend, which ignores day-to-day water swings; the last weigh-in shows beside it.
 */

export type WeighInSource = 'manual' | 'health_connect';

export interface WeighIn {
  id: string;
  /** ISO instant. */
  measuredAt: string;
  /** Local date of `measuredAt`. */
  date: IsoDate;
  kg: number;
  source: WeighInSource;
}

export interface TrendPoint {
  date: IsoDate;
  /** Smoothed weight on this day. */
  kg: number;
  /** The day's first weigh-in, which the trend used. */
  weighInKg: number;
}

/** Time constant of the trend, in days. */
export const TREND_DAYS = 7;
/** Window for the weekly rate, and what it needs inside it. */
export const RATE_WINDOW_DAYS = 14;
export const RATE_MIN_SPAN_DAYS = 7;
/** Trend within this of the plan line reads "On track". */
export const ON_TRACK_KG = 0.5;

/**
 * One point per day with a weigh-in, oldest first. Each day uses its first weigh-in
 * (morning weights are the most consistent). The trend starts at the first weigh-in and
 * moves toward each new one by `1 - e^(-gap / 7)`, so missed days count as time passed.
 */
export function weightTrend(entries: readonly Pick<WeighIn, 'date' | 'measuredAt' | 'kg'>[]): TrendPoint[] {
  const first = new Map<IsoDate, { at: string; kg: number }>();
  for (const e of entries) {
    const cur = first.get(e.date);
    if (!cur || e.measuredAt < cur.at) first.set(e.date, { at: e.measuredAt, kg: e.kg });
  }
  const days = [...first.entries()].sort(([a], [b]) => a.localeCompare(b));
  const out: TrendPoint[] = [];
  for (const [date, { kg }] of days) {
    const prev = out[out.length - 1];
    const trend = prev ? prev.kg + (kg - prev.kg) * (1 - Math.exp(-diffDays(prev.date, date) / TREND_DAYS)) : kg;
    out.push({ date, kg: trend, weighInKg: kg });
  }
  return out;
}

/**
 * Change per week (negative when losing), from a least-squares line through the last 14
 * days of daily weigh-ins. The line already averages out the swings, and fitting the trend
 * instead would lag a steady change. Undefined until there are weigh-ins on 2 days at
 * least 7 days apart.
 */
export function weightRate(points: readonly TrendPoint[], today: IsoDate): number | undefined {
  const from = addDays(today, -RATE_WINDOW_DAYS);
  const recent = points.filter((p) => p.date >= from && p.date <= today);
  if (recent.length < 2 || diffDays(recent[0]!.date, recent[recent.length - 1]!.date) < RATE_MIN_SPAN_DAYS) return undefined;
  const xs = recent.map((p) => diffDays(from, p.date));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = recent.reduce((a, p) => a + p.weighInKg, 0) / recent.length;
  let num = 0;
  let den = 0;
  recent.forEach((p, i) => {
    num += (xs[i]! - mx) * (p.weighInKg - my);
    den += (xs[i]! - mx) ** 2;
  });
  return (num / den) * 7;
}

export type WeightGoalStatus = 'active' | 'reached' | 'stopped';

export interface WeightGoal {
  id: string;
  startDate: IsoDate;
  startKg: number;
  targetKg: number;
  /** Always positive; the direction comes from target against start. */
  paceKgWeek: number;
  status: WeightGoalStatus;
  reachedAt?: IsoDate;
}

/** Pace choices in kg a week: 0.25 to 1 kg, or 0.5 to 2 lb when the app shows pounds. */
export function weightPaces(unit: WeightUnit): number[] {
  return (unit === 'lb' ? [0.5, 1, 1.5, 2] : [0.25, 0.5, 0.75, 1]).map((v) => unitToKg(v, unit));
}

/** Paces above 1% of the start weight a week are not offered. */
export function allowedPaces(unit: WeightUnit, startKg: number): number[] {
  const all = weightPaces(unit);
  const ok = all.filter((p) => p <= startKg * 0.01 + 1e-9);
  return ok.length > 0 ? ok : all.slice(0, 1);
}

export function expectedGoalDate(goal: Pick<WeightGoal, 'startDate' | 'startKg' | 'targetKg' | 'paceKgWeek'>): IsoDate {
  return addDays(goal.startDate, Math.ceil((Math.abs(goal.targetKg - goal.startKg) / goal.paceKgWeek) * 7));
}

/** Where the straight plan line from start to target sits on a date. */
export function planKgOn(goal: Pick<WeightGoal, 'startDate' | 'startKg' | 'targetKg' | 'paceKgWeek'>, date: IsoDate): number {
  const sign = Math.sign(goal.targetKg - goal.startKg);
  const moved = (Math.max(0, diffDays(goal.startDate, date)) / 7) * goal.paceKgWeek;
  return goal.startKg + sign * Math.min(moved, Math.abs(goal.targetKg - goal.startKg));
}

export interface GoalProgress {
  direction: 'lose' | 'gain';
  expectedDate: IsoDate;
  planKg: number;
  /** Trend against the plan line in the goal's direction: positive is ahead. */
  aheadKg: number;
  status: 'on_track' | 'ahead' | 'behind' | 'reached';
  /** Share of the way from start to target, 0 to 1. */
  progress: number;
  /** Still to go, in the goal's direction (0 once reached). */
  remainingKg: number;
}

export function goalProgress(goal: WeightGoal, trendKg: number, today: IsoDate): GoalProgress {
  const direction = goal.targetKg < goal.startKg ? 'lose' : 'gain';
  const sign = direction === 'lose' ? -1 : 1;
  const span = Math.abs(goal.targetKg - goal.startKg);
  const done = (trendKg - goal.startKg) * sign;
  const planKg = planKgOn(goal, today);
  const aheadKg = (trendKg - planKg) * sign;
  const reached = goal.status === 'reached' || goalReached(goal, trendKg);
  return {
    direction,
    expectedDate: expectedGoalDate(goal),
    planKg,
    aheadKg,
    status: reached ? 'reached' : Math.abs(aheadKg) <= ON_TRACK_KG ? 'on_track' : aheadKg > 0 ? 'ahead' : 'behind',
    progress: span === 0 ? 1 : Math.min(1, Math.max(0, done / span)),
    remainingKg: reached ? 0 : Math.max(0, span - done),
  };
}

/** The trend has crossed the target. */
export function goalReached(goal: Pick<WeightGoal, 'startKg' | 'targetKg'>, trendKg: number): boolean {
  return goal.targetKg < goal.startKg ? trendKg <= goal.targetKg : trendKg >= goal.targetKg;
}
