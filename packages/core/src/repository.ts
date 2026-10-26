import type { AgendaItem, CompletionDetails, ScheduleSlot, SkipReason } from './agenda';
import type { IsoDate, Weekday } from './dates';
import type { HrProfileInput, HrZoneBand } from './hr';
import type { UnitPrefs } from './units';

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

  // Settings
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
}
