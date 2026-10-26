import type { AgendaItem, AgendaStatus, CompletionDetails, Lane, PlanRole, ScheduleSlot, SkipReason } from './agenda';
import { LANE_ORDER } from './agenda';
import { addDays, dateRange, startOfWeek, weekdayOf, type IsoDate, type Weekday } from './dates';
import { zoneBand, type HrZoneBand } from './hr';
import { isHardWorkout } from './moving';
import type { PaceLookup, Workout } from './workout';
import { flattenSteps, stepSeconds, structureSegments, totalMeters, totalSeconds } from './workout';

/**
 * Weekly schedule expansion with "just this time" overrides (spec §8, §9, §10), and
 * the agenda builder that merges plan workouts and schedule occurrences into the one
 * list Today and Plan render.
 */

export interface ScheduleRow {
  id: string;
  weekday: Weekday;
  routineId: string;
  slot?: ScheduleSlot;
  time?: string;
  /** First date this entry applies (inclusive). "Change the schedule" starts a new entry. */
  startsOn?: IsoDate;
  /** Last date this entry applies (inclusive). */
  endsOn?: IsoDate;
}

/** One occurrence moved ("just this time"). `newDate: null` removes that occurrence. */
export interface OverrideRow {
  scheduleId: string;
  originalDate: IsoDate;
  newDate: IsoDate | null;
}

export interface Occurrence {
  scheduleId: string;
  routineId: string;
  originalDate: IsoDate;
  date: IsoDate;
  slot?: ScheduleSlot;
  time?: string;
}

export const occurrenceKey = (scheduleId: string, originalDate: IsoDate) => `${scheduleId}@${originalDate}`;

export function parseOccurrenceKey(key: string): { scheduleId: string; originalDate: IsoDate } | undefined {
  const at = key.lastIndexOf('@');
  if (at <= 0) return undefined;
  return { scheduleId: key.slice(0, at), originalDate: key.slice(at + 1) };
}

function appliesOn(row: ScheduleRow, date: IsoDate): boolean {
  return weekdayOf(date) === row.weekday && (!row.startsOn || date >= row.startsOn) && (!row.endsOn || date <= row.endsOn);
}

/** Occurrences whose effective date falls in [start, end], including ones moved in from outside. */
export function expandSchedule(rows: readonly ScheduleRow[], overrides: readonly OverrideRow[], start: IsoDate, end: IsoDate): Occurrence[] {
  const byKey = new Map(overrides.map((o) => [occurrenceKey(o.scheduleId, o.originalDate), o]));
  const out: Occurrence[] = [];

  const emit = (row: ScheduleRow, originalDate: IsoDate) => {
    const o = byKey.get(occurrenceKey(row.id, originalDate));
    const date = o ? o.newDate : originalDate;
    if (date === null || date < start || date > end) return;
    const occ: Occurrence = { scheduleId: row.id, routineId: row.routineId, originalDate, date };
    if (row.slot) occ.slot = row.slot;
    if (row.time) occ.time = row.time;
    out.push(occ);
  };

  for (const date of dateRange(start, end)) for (const row of rows) if (appliesOn(row, date)) emit(row, date);

  // Moved in from outside the range.
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  for (const o of overrides) {
    if (o.newDate === null || o.newDate < start || o.newDate > end) continue;
    if (o.originalDate >= start && o.originalDate <= end) continue;
    const row = rowsById.get(o.scheduleId);
    if (row && appliesOn(row, o.originalDate)) emit(row, o.originalDate);
  }
  return out;
}

/**
 * "Change the schedule": end the old entry the day before the moved occurrence and
 * start a new entry on the target weekday from that week, so past weeks keep their days.
 */
export function rescheduleEntry(row: ScheduleRow, originalDate: IsoDate, toDate: IsoDate): { ended: ScheduleRow; started: Omit<ScheduleRow, 'id'> } {
  const ended: ScheduleRow = { ...row, endsOn: addDays(originalDate, -1) };
  const { id: _id, endsOn: _endsOn, ...rest } = row;
  const started: Omit<ScheduleRow, 'id'> = { ...rest, weekday: weekdayOf(toDate), startsOn: startOfWeek(originalDate) };
  if (row.endsOn) started.endsOn = row.endsOn;
  return { ended, started };
}

// ---------------------------------------------------------------------------
// Agenda

export interface PlanWorkoutRow {
  id: string;
  planId: string;
  workout: Workout;
  date: IsoDate;
  originalDate: IsoDate;
  weekIndex: number;
  role: PlanRole;
  status: 'scheduled' | 'done' | 'missed' | 'skipped' | 'moved';
  completedAt?: string;
  details?: CompletionDetails;
  skipReason?: SkipReason;
  sessionId?: string;
  externalSessionId?: string;
}

export interface RoutineInfo {
  name: string;
  kind: 'strength' | 'stretch';
  estSeconds: number;
}

export interface CompletionRow {
  scheduleId: string;
  /** Original date of the occurrence. */
  date: IsoDate;
  status: 'done' | 'skipped';
  completedAt?: string;
  details?: CompletionDetails;
  skipReason?: SkipReason;
  sessionId?: string;
  externalSessionId?: string;
}

export interface AgendaInput {
  start: IsoDate;
  end: IsoDate;
  planWorkouts: readonly PlanWorkoutRow[];
  schedule: readonly ScheduleRow[];
  overrides: readonly OverrideRow[];
  completions: readonly CompletionRow[];
  routines: ReadonlyMap<string, RoutineInfo>;
  hrZones?: readonly HrZoneBand[];
  pace?: PaceLookup;
}

/** The heart-rate range of the longest HR-targeted step, for "128-145 bpm" on cards. */
function mainHrRange(w: Workout, zones?: readonly HrZoneBand[]): AgendaItem['hrRange'] {
  let best: { seconds: number; range: { minBpm: number; maxBpm: number } } | undefined;
  for (const s of flattenSteps(w.items)) {
    const t = s.target;
    let range: { minBpm: number; maxBpm: number } | undefined;
    if (t.type === 'hr_range') range = { minBpm: t.minBpm, maxBpm: t.maxBpm };
    else if (t.type === 'hr_zone' && zones) {
      const band = zoneBand(zones, t.zone);
      range = { minBpm: band.minBpm, maxBpm: band.maxBpm };
    }
    const seconds = stepSeconds(s);
    if (range && (!best || seconds > best.seconds)) best = { seconds, range };
  }
  return best?.range;
}

const planStatus = (s: PlanWorkoutRow['status']): AgendaStatus => (s === 'done' ? 'done' : s === 'skipped' ? 'skipped' : 'pending');

export function buildAgenda(input: AgendaInput): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const pw of input.planWorkouts) {
    if (pw.date < input.start || pw.date > input.end) continue;
    const item: AgendaItem = {
      key: pw.id,
      lane: 'run',
      date: pw.date,
      originalDate: pw.originalDate,
      source: { type: 'plan_workout', planWorkoutId: pw.id, planId: pw.planId, weekIndex: pw.weekIndex, role: pw.role },
      title: pw.workout.name,
      refId: pw.workout.id,
      hard: isHardWorkout(pw.role, pw.workout.items),
      estSeconds: Math.round(totalSeconds(pw.workout.items, input.pace)),
      estMeters: Math.round(totalMeters(pw.workout.items, input.pace)),
      structure: structureSegments(pw.workout.items, input.pace),
      status: planStatus(pw.status),
    };
    const hr = mainHrRange(pw.workout, input.hrZones);
    if (hr) item.hrRange = hr;
    if (pw.completedAt) item.completedAt = pw.completedAt;
    if (pw.details) item.details = pw.details;
    if (pw.skipReason) item.skipReason = pw.skipReason;
    if (pw.sessionId) item.sessionId = pw.sessionId;
    if (pw.externalSessionId) item.externalSessionId = pw.externalSessionId;
    items.push(item);
  }

  const completions = new Map(input.completions.map((c) => [occurrenceKey(c.scheduleId, c.date), c]));
  for (const occ of expandSchedule(input.schedule, input.overrides, input.start, input.end)) {
    const routine = input.routines.get(occ.routineId);
    if (!routine) continue;
    const key = occurrenceKey(occ.scheduleId, occ.originalDate);
    const c = completions.get(key);
    const lane: Lane = routine.kind === 'strength' ? 'workout' : 'stretch';
    const item: AgendaItem = {
      key,
      lane,
      date: occ.date,
      originalDate: occ.originalDate,
      source: { type: 'schedule', scheduleId: occ.scheduleId, routineId: occ.routineId },
      title: routine.name,
      refId: occ.routineId,
      hard: false,
      estSeconds: routine.estSeconds,
      status: c?.status ?? 'pending',
    };
    if (occ.slot) item.slot = occ.slot;
    if (occ.time) item.time = occ.time;
    if (c?.completedAt) item.completedAt = c.completedAt;
    if (c?.details) item.details = c.details;
    if (c?.skipReason) item.skipReason = c.skipReason;
    if (c?.sessionId) item.sessionId = c.sessionId;
    if (c?.externalSessionId) item.externalSessionId = c.externalSessionId;
    items.push(item);
  }

  const slotRank = (i: AgendaItem) => (i.time ? i.time : i.slot === 'morning' ? '06:00' : i.slot === 'evening' ? '20:00' : '12:00');
  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || slotRank(a).localeCompare(slotRank(b)) || a.key.localeCompare(b.key),
  );
}
