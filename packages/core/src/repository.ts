import type { AgendaItem, CompletionDetails, ScheduleSlot, SkipReason } from './agenda';
import type { IsoDate, Weekday } from './dates';
import type { HrProfileInput, HrZoneBand } from './hr';
import type { TrackPoint } from './session/geo';
import type { PlayerState, StepLogEntry } from './session/player';
import type { StepResult } from './session/track';
import type { UnitPrefs } from './units';
import type { SessionMode } from './workout';

/**
 * The contract between screens and storage. The mobile app calls this through its
 * store; `@fit/schema` implements it on SQLite (synchronous, so the first frame
 * renders from data with no loading state). Every write stamps updated_at and dirty.
 */

export interface HrProfile extends HrProfileInput {
  id: string;
  zones: HrZoneBand[];
  createdAt: string;
}

export type PlanPresetId = '5k-8wk' | 'z2-base-8wk';

export interface PlanInputs {
  presetId: PlanPresetId;
  /** Race plans: race day. Fitness plans: omitted. */
  raceDate?: IsoDate;
  /** Fitness plans: first day. Race plans derive it from raceDate. */
  startDate?: IsoDate;
  daysPerWeek: number;
  /** Preferred weekdays, length >= daysPerWeek. */
  preferredDays: Weekday[];
  longRunDay: Weekday;
  /** 5K: goal finish time in seconds; drives paces. */
  goalSeconds?: number;
  /** Easy runs targeted by pace or by heart rate. Zone 2 plans are always HR. */
  easyBy: 'pace' | 'hr';
  treadmill: 'none' | 'some' | 'mostly';
}

export interface PlanSummary {
  id: string;
  presetId: PlanPresetId;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  weeks: number;
  /** 1-based week containing `today`, clamped to the plan. */
  currentWeek: number;
  /** Weekly measure: miles for race plans, Zone 2 minutes for Zone 2 plans. */
  measure: { kind: 'distance'; plannedM: number; doneM: number } | { kind: 'z2_minutes'; planned: number; done: number };
  inputs: PlanInputs;
}

export interface Routine {
  id: string;
  kind: 'strength' | 'stretch';
  name: string;
  /** Exercise count for strength, move count for stretch. */
  itemCount: number;
  estSeconds: number;
}

export interface ScheduleEntry {
  id: string;
  weekday: Weekday;
  routineId: string;
  slot?: ScheduleSlot;
  time?: string;
  reminder: boolean;
  position: number;
}

export type QuickLogType = 'walk' | 'hike' | 'bike' | 'swim' | 'run' | 'lift' | 'stretch' | 'other';

export interface QuickLog {
  id: string;
  date: IsoDate;
  activityType: QuickLogType;
  minutes: number;
  distanceM?: number;
  note?: string;
}

export interface Settings {
  units: UnitPrefs;
  stepGoal: number;
  easyBy: 'pace' | 'hr';
  onboarded: boolean;
}

// Sessions (M1): recorded runs. Track points are buffered in memory and written with
// saveProgress every 5 s in one transaction, together with the player state, so a crash
// loses at most 5 s and activeSession() can resume or save what was recorded.

export interface SessionStartInput {
  name: string;
  mode: SessionMode;
  /** ISO instant. */
  startedAt: string;
  workoutId?: string;
  /** The plan workout this run completes; marked done (with data) on finish. */
  planWorkoutId?: string;
  player: PlayerState;
}

export interface ActiveSession {
  id: string;
  name: string;
  mode: SessionMode;
  startedAt: string;
  workoutId?: string;
  planWorkoutId?: string;
  player: PlayerState;
  distanceM: number;
  /** Last persisted point, so a resumed recorder can continue the line. */
  lastPoint?: TrackPoint;
}

export interface SessionProgress {
  player: PlayerState;
  distanceM: number;
  /** Points since the last save (not the whole track). */
  points: TrackPoint[];
}

export interface SessionFinish {
  endedAt: string;
  player: PlayerState;
  distanceM: number;
  elapsedMs: number;
  pausedMs: number;
  rpe?: number;
  notes?: string;
}

export interface SessionListItem {
  id: string;
  name: string;
  mode: SessionMode;
  startedAt: string;
  distanceM: number;
  elapsedMs: number;
}

export interface SessionDetail extends SessionListItem {
  endedAt?: string;
  pausedMs: number;
  avgPaceSecPerKm?: number;
  rpe?: number;
  notes?: string;
  workoutId?: string;
  planWorkoutId?: string;
  steps: StepResult[];
  log: StepLogEntry[];
  /** Full-resolution track; simplify with simplifyTo() for drawing. */
  points: TrackPoint[];
}

/** How a recurring (schedule) item moves. Plan workouts always move "once". */
export type MoveScope = 'once' | 'schedule';

export interface FitRepository {
  // Agenda
  agenda(start: IsoDate, end: IsoDate): AgendaItem[];
  markDone(key: string, completedAt: string, details?: CompletionDetails): void;
  skip(key: string, reason?: SkipReason): void;
  /** Back to pending (undo of done/skip). */
  reopen(key: string): void;
  move(key: string, toDate: IsoDate, scope: MoveScope): void;
  swap(keyA: string, keyB: string): void;

  // Quick log
  addQuickLog(log: Omit<QuickLog, 'id'>): QuickLog;
  quickLogs(start: IsoDate, end: IsoDate): QuickLog[];

  // Heart rate
  currentHrProfile(): HrProfile | undefined;
  saveHrProfile(input: HrProfileInput): HrProfile;

  // Running plan
  activePlan(today: IsoDate): PlanSummary | undefined;
  createPlan(inputs: PlanInputs, today: IsoDate): PlanSummary;
  abandonPlan(planId: string): void;

  // Weekly schedule
  routines(): Routine[];
  schedule(): ScheduleEntry[];
  addScheduleEntry(entry: Omit<ScheduleEntry, 'id' | 'position'>): ScheduleEntry;
  updateScheduleEntry(id: string, patch: Partial<Omit<ScheduleEntry, 'id'>>): void;
  removeScheduleEntry(id: string): void;

  // Sessions
  startSession(input: SessionStartInput): string;
  saveProgress(id: string, progress: SessionProgress): void;
  finishSession(id: string, finish: SessionFinish): void;
  discardSession(id: string): void;
  activeSession(): ActiveSession | undefined;
  session(id: string): SessionDetail | undefined;
  recentSessions(limit: number): SessionListItem[];
  updateSessionNotes(id: string, patch: { rpe?: number; notes?: string }): void;

  // Settings
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
}
