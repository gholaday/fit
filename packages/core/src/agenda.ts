import type { IsoDate } from './dates';
import type { StructureSegment } from './workout';

/**
 * The agenda is the one shape Today and Plan render: every item scheduled on a day,
 * across the three lanes. Built from SQLite rows by `buildAgenda` (see schedule.ts).
 */
export type Lane = 'run' | 'workout' | 'stretch';

export type AgendaStatus = 'pending' | 'done' | 'skipped';

export type SkipReason = 'sick' | 'busy' | 'sore' | 'other';

/** Optional details from "Done + details" (spec §3). SI units. */
export interface CompletionDetails {
  minutes?: number;
  distanceM?: number;
  rpe?: number;
  note?: string;
}

export type AgendaSource =
  | { type: 'plan_workout'; planWorkoutId: string; planId: string; weekIndex: number; role: PlanRole }
  | { type: 'schedule'; scheduleId: string; routineId: string };

/** Plan slot roles (spec §8). `retest` replaces a quality slot in retest weeks. */
export type PlanRole = 'long' | 'quality' | 'quality2' | 'easy' | 'easy2' | 'retest';

export type ScheduleSlot = 'morning' | 'evening' | 'any';

export interface AgendaItem {
  /** Stable key: plan workout id, or `${scheduleId}@${originalDate}` for schedule occurrences. */
  key: string;
  lane: Lane;
  /** Effective date (after moves/overrides). */
  date: IsoDate;
  /** Date it was originally planned for. Differs from `date` when moved. */
  originalDate: IsoDate;
  source: AgendaSource;
  title: string;
  /** Workout id for runs, routine id for workouts and stretches. */
  refId: string;
  slot?: ScheduleSlot;
  /** "07:00", 24h local time, when the schedule has one. */
  time?: string;
  /** Hard days drive back-to-back warnings (quality, long, retest). */
  hard: boolean;
  estSeconds: number;
  estMeters?: number;
  /** Structure bar for runs. */
  structure?: StructureSegment[];
  /** Main heart-rate target for HR plans, for "128-145 bpm" on the card. */
  hrRange?: { minBpm: number; maxBpm: number };
  status: AgendaStatus;
  completedAt?: string;
  details?: CompletionDetails;
  skipReason?: SkipReason;
}

/** Completion level (spec §3), derived from status + what is attached. */
export type CompletionLevel = 'done' | 'done_details' | 'done_data' | 'skipped' | 'moved' | 'pending';

export function completionLevel(item: Pick<AgendaItem, 'status' | 'details' | 'date' | 'originalDate'>, hasSession = false): CompletionLevel {
  if (item.status === 'skipped') return 'skipped';
  if (item.status === 'done') {
    if (hasSession) return 'done_data';
    const d = item.details;
    if (d && (d.minutes !== undefined || d.distanceM !== undefined || d.rpe !== undefined || (d.note ?? '') !== '')) return 'done_details';
    return 'done';
  }
  return item.date !== item.originalDate ? 'moved' : 'pending';
}

export const LANE_ORDER: readonly Lane[] = ['run', 'workout', 'stretch'];
