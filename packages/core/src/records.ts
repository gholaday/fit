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

export const LIFT_RECORD_KINDS: readonly LiftRecordKind[] = ['heaviest', 'one_rep_max', 'set_volume', 'session_volume', 'most_reps', 'longest_hold'];

/**
 * What one set scores on each lift record: weighted sets give heaviest, estimated 1 rep
 * max and set volume; bodyweight sets give reps; timed sets give the hold.
 */
export function setValues(set: Pick<LoggedSet, 'reps' | 'weightKg' | 'durationS'>): LiftBests {
  const w = set.weightKg ?? 0;
  if (w > 0 && set.reps > 0) {
    const out: LiftBests = { heaviest: w, set_volume: Math.round(w * set.reps * 10) / 10 };
    const orm = oneRepMax(w, set.reps);
    if (orm !== undefined) out.one_rep_max = orm;
    return out;
  }
  if ((set.durationS ?? 0) > 0) return { longest_hold: set.durationS! };
  if (set.reps > 0) return { most_reps: set.reps };
  return {};
}

/** One exercise's sets in a session, on every lift record (session volume sums the weighted sets). */
export function liftValues(sets: readonly Pick<LoggedSet, 'reps' | 'weightKg' | 'durationS'>[]): LiftBests {
  const out: LiftBests = {};
  let volume = 0;
  for (const s of sets) {
    const v = setValues(s);
    for (const kind of LIFT_RECORD_KINDS) {
      const x = v[kind];
      if (x !== undefined && (out[kind] === undefined || x > out[kind]!)) out[kind] = x;
    }
    if (v.heaviest !== undefined) volume += s.weightKg! * s.reps;
  }
  if (volume > 0) out.session_volume = Math.round(volume * 10) / 10;
  return out;
}

export interface RecordItem {
  run?: RunRecordInput;
  lift?: LiftRecordInput;
}

export interface RecordBook {
  /** Every record move so far, in session order. */
  readonly events: RecordEvent[];
  /** Start of the latest session added. A session that started earlier needs a full replay. */
  readonly lastAt: string;
  /** Adds the next session in start order and returns the record moves it made. */
  add(item: RecordItem): RecordEvent[];
}

/**
 * Replays sessions one at a time in start order. Keep the book to extend it after a save
 * instead of replaying every session again.
 */
export function recordBook(): RecordBook {
  let lastAt = '';
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

  const add = ({ run, lift }: RecordItem): RecordEvent[] => {
    const start = events.length;
    lastAt = (run ?? lift)?.startedAt ?? lastAt;
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
        const values = liftValues(sets);
        for (const kind of LIFT_RECORD_KINDS) {
          const value = values[kind];
          if (value !== undefined) consider({ ...base, key: `lift:${exerciseId}:${kind}`, kind, value });
        }
      }
    }
    return events.slice(start);
  };

  return {
    events,
    add,
    get lastAt() {
      return lastAt;
    },
  };
}

const startOf = (i: RecordItem) => (i.run ?? i.lift)!.startedAt;

/** Replays every session in start order: a full record book. */
export function computeRecords(runs: readonly RunRecordInput[], lifts: readonly LiftRecordInput[]): RecordEvent[] {
  return replay(runs, lifts).events;
}

export function replay(runs: readonly RunRecordInput[], lifts: readonly LiftRecordInput[]): RecordBook {
  const items: RecordItem[] = [...runs.map((run) => ({ run })), ...lifts.map((lift) => ({ lift }))].sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const book = recordBook();
  for (const item of items) book.add(item);
  return book;
}

export type LiftBests = Partial<Record<LiftRecordKind, number>>;

/**
 * Set records beaten while logging, for the trophy on the set row. Session volume is
 * judged at finish. Nothing is beaten without an earlier value (the quiet first rule).
 */
export function setRecords(set: Pick<LoggedSet, 'reps' | 'weightKg' | 'durationS'>, bests: LiftBests): LiftRecordKind[] {
  const values = setValues(set);
  return LIFT_RECORD_KINDS.filter((kind) => {
    const value = values[kind];
    const prev = bests[kind];
    return value !== undefined && prev !== undefined && value > prev;
  });
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
