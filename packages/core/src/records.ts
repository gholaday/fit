import { startOfWeek, type IsoDate } from './dates';
import type { LoggedSet } from './routine';
import { PB_DISTANCES, type SessionStats } from './stats';

/**
 * Personal records (Hevy-style trophies) for runs and lifts. Pure: give it every saved
 * run and strength session; it replays them in order and returns each time a record
 * moved. The first value of a record is kept quietly, so early weeks are not a stream
 * of trophies; firsts (first 5 km, first hour) always celebrate.
 */

export type RunRecordKind = 'effort' | 'longest_distance' | 'longest_time' | 'longest_nonstop' | 'biggest_week' | 'first_distance' | 'first_hour';
export type LiftRecordKind = 'heaviest' | 'one_rep_max' | 'set_volume' | 'most_reps' | 'longest_hold' | 'session_volume';

export interface RecordEvent {
  /** Stable id of the record: 'run:effort:5000', 'run:longest_distance', 'lift:<exerciseId>:heaviest'. */
  key: string;
  group: 'run' | 'lift';
  kind: RunRecordKind | LiftRecordKind;
  exerciseId?: string;
  /** Distance of an effort or a first, in meters. */
  meters?: number;
  /** Seconds (efforts, times, holds), meters (distances, weeks), kg (weights, volumes) or reps. */
  value: number;
  previous?: number;
  sessionId: string;
  date: IsoDate;
  /** Improvements and firsts. The first value of a record is false. */
  celebrate: boolean;
}

export interface RunRecordInput {
  sessionId: string;
  date: IsoDate;
  /** ISO instant, for ordering runs on the same day. */
  startedAt: string;
  distanceM: number;
  durationS: number;
  /** Fit runs carry best efforts and the longest non-stop stretch; watch imports do not. */
  stats?: Pick<SessionStats, 'bests' | 'nonstopS'>;
}

export interface LiftRecordInput {
  sessionId: string;
  date: IsoDate;
  startedAt: string;
  sets: readonly LoggedSet[];
}

/** First distances that celebrate once. */
export const FIRST_DISTANCES = [5000, 10000, 21097.5] as const;
const FIRST_HOUR_S = 3600;

/** Epley estimate; sets over 12 reps say little about a single rep, so they don't count. */
export function oneRepMax(weightKg: number, reps: number): number | undefined {
  if (weightKg <= 0 || reps < 1 || reps > 12) return undefined;
  return reps === 1 ? weightKg : Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

const lowerIsBetter = (kind: RecordEvent['kind']) => kind === 'effort';

export function computeRecords(runs: readonly RunRecordInput[], lifts: readonly LiftRecordInput[]): RecordEvent[] {
  type Item = { at: string; run?: RunRecordInput; lift?: LiftRecordInput };
  const items: Item[] = [...runs.map((run) => ({ at: run.startedAt, run })), ...lifts.map((lift) => ({ at: lift.startedAt, lift }))].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const best = new Map<string, number>();
  const events: RecordEvent[] = [];

  const consider = (e: Omit<RecordEvent, 'previous' | 'celebrate'>) => {
    const prev = best.get(e.key);
    const better = prev === undefined || (lowerIsBetter(e.kind) ? e.value < prev : e.value > prev);
    if (!better) return;
    best.set(e.key, e.value);
    events.push({ ...e, ...(prev !== undefined ? { previous: prev } : {}), celebrate: prev !== undefined });
  };

  const weeks = new Map<IsoDate, number>();
  let bestWeek: { week: IsoDate; m: number } | undefined;
  const firsts = new Set<string>();

  for (const { run, lift } of items) {
    if (run) {
      const base = { group: 'run' as const, sessionId: run.sessionId, date: run.date };
      for (const b of run.stats?.bests ?? []) consider({ ...base, key: `run:effort:${b.meters}`, kind: 'effort', meters: b.meters, value: b.seconds });
      if (run.distanceM > 0) consider({ ...base, key: 'run:longest_distance', kind: 'longest_distance', value: Math.round(run.distanceM) });
      if (run.durationS > 0) consider({ ...base, key: 'run:longest_time', kind: 'longest_time', value: run.durationS });
      if (run.stats?.nonstopS) {
        const before = events.length;
        consider({ ...base, key: 'run:longest_nonstop', kind: 'longest_nonstop', value: run.stats.nonstopS });
        // Without any walking it would repeat the longest time trophy; it still moves the record.
        if (events.length > before && run.stats.nonstopS >= run.durationS - 1) events[events.length - 1]!.celebrate = false;
      }

      // Biggest week celebrates when a week first overtakes the record; later runs that
      // week raise it quietly.
      const week = startOfWeek(run.date);
      const total = (weeks.get(week) ?? 0) + run.distanceM;
      weeks.set(week, total);
      if (!bestWeek || total > bestWeek.m) {
        const prev = bestWeek;
        const value = Math.round(total);
        events.push({
          ...base,
          key: 'run:biggest_week',
          kind: 'biggest_week',
          value,
          ...(prev ? { previous: Math.round(prev.m) } : {}),
          celebrate: prev !== undefined && prev.week !== week,
        });
        bestWeek = { week, m: total };
      }

      for (const m of FIRST_DISTANCES) {
        const key = `run:first:${m}`;
        if (!firsts.has(key) && run.distanceM >= m) {
          firsts.add(key);
          events.push({ ...base, key, kind: 'first_distance', meters: m, value: Math.round(run.distanceM), celebrate: true });
        }
      }
      if (!firsts.has('run:first_hour') && run.durationS >= FIRST_HOUR_S) {
        firsts.add('run:first_hour');
        events.push({ ...base, key: 'run:first_hour', kind: 'first_hour', value: run.durationS, celebrate: true });
      }
    }

    if (lift) {
      const byExercise = new Map<string, LoggedSet[]>();
      for (const s of lift.sets) byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s]);
      for (const [exerciseId, sets] of byExercise) {
        const base = { group: 'lift' as const, exerciseId, sessionId: lift.sessionId, date: lift.date };
        const k = (kind: LiftRecordKind) => `lift:${exerciseId}:${kind}`;
        const weighted = sets.filter((s) => (s.weightKg ?? 0) > 0 && s.reps > 0);
        if (weighted.length > 0) {
          consider({ ...base, key: k('heaviest'), kind: 'heaviest', value: Math.max(...weighted.map((s) => s.weightKg!)) });
          const orm = weighted.flatMap((s) => oneRepMax(s.weightKg!, s.reps) ?? []);
          if (orm.length > 0) consider({ ...base, key: k('one_rep_max'), kind: 'one_rep_max', value: Math.max(...orm) });
          const volumes = weighted.map((s) => s.weightKg! * s.reps);
          consider({ ...base, key: k('set_volume'), kind: 'set_volume', value: Math.round(Math.max(...volumes) * 10) / 10 });
          consider({ ...base, key: k('session_volume'), kind: 'session_volume', value: Math.round(volumes.reduce((a, b) => a + b, 0) * 10) / 10 });
        }
        const bodyweight = sets.filter((s) => !s.weightKg && !s.durationS && s.reps > 0);
        if (bodyweight.length > 0) consider({ ...base, key: k('most_reps'), kind: 'most_reps', value: Math.max(...bodyweight.map((s) => s.reps)) });
        const holds = sets.filter((s) => (s.durationS ?? 0) > 0);
        if (holds.length > 0) consider({ ...base, key: k('longest_hold'), kind: 'longest_hold', value: Math.max(...holds.map((s) => s.durationS!)) });
      }
    }
  }
  return events;
}

export type LiftBests = Partial<Record<LiftRecordKind, number>>;

/**
 * Set records beaten while logging, for the trophy on the set row. Session volume is
 * judged at finish. Nothing is beaten without an earlier value (the quiet first rule).
 */
export function setRecords(set: Pick<LoggedSet, 'reps' | 'weightKg' | 'durationS'>, bests: LiftBests): LiftRecordKind[] {
  const out: LiftRecordKind[] = [];
  const beats = (kind: LiftRecordKind, value: number | undefined) => {
    const prev = bests[kind];
    if (value !== undefined && prev !== undefined && value > prev) out.push(kind);
  };
  const w = set.weightKg ?? 0;
  if (w > 0 && set.reps > 0) {
    beats('heaviest', w);
    beats('one_rep_max', oneRepMax(w, set.reps));
    beats('set_volume', Math.round(w * set.reps * 10) / 10);
  } else if ((set.durationS ?? 0) > 0) beats('longest_hold', set.durationS);
  else if (set.reps > 0) beats('most_reps', set.reps);
  return out;
}

/** The standing record for each key: the last event, since events only move a record forward. */
export function currentRecords(events: readonly RecordEvent[]): RecordEvent[] {
  const latest = new Map<string, RecordEvent>();
  for (const e of events) latest.set(e.key, e);
  return [...latest.values()];
}

/** Display label for a run record: "5 km", "Longest run", "First half marathon". */
export function runRecordLabel(e: Pick<RecordEvent, 'kind' | 'meters'>): string {
  const distance = (m?: number) => PB_DISTANCES.find((d) => Math.abs(d.meters - (m ?? 0)) < 1)?.label ?? `${Math.round((m ?? 0) / 1000)} km`;
  switch (e.kind) {
    case 'effort':
      return distance(e.meters);
    case 'longest_distance':
      return 'Longest run';
    case 'longest_time':
      return 'Longest time';
    case 'longest_nonstop':
      return 'Longest non-stop run';
    case 'biggest_week':
      return 'Biggest week';
    case 'first_distance':
      return `First ${distance(e.meters).replace('Half marathon', 'half marathon')}`;
    case 'first_hour':
      return 'First hour of running';
    default:
      return '';
  }
}

export const LIFT_RECORD_LABELS: Record<LiftRecordKind, string> = {
  heaviest: 'Heaviest weight',
  one_rep_max: 'Best estimated 1 rep max',
  set_volume: 'Best set volume',
  most_reps: 'Most reps',
  longest_hold: 'Longest hold',
  session_volume: 'Best session volume',
};
