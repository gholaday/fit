import type { AgendaItem, CompletionDetails, ScheduleSlot, SkipReason } from './agenda';
import type { IsoDate, Weekday } from './dates';
import type { HrProfileInput, HrZoneBand } from './hr';
import type { CuePrefs } from './session/cues';
import type { TrackPoint } from './session/geo';
import type { PlayerState, StepLogEntry } from './session/player';
import type { StepResult } from './session/track';
import type { UnitPrefs } from './units';
import type { Catalog, Equipment, Exercise, ExerciseKind, Muscle, Tracking } from './exercise';
import type { LoggedSet, RoutineItems } from './routine';
import type { SessionMode, Workout } from './workout';

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
  /** 5K: goal finish time in seconds. Drives paces when there is no recent race. */
  goalSeconds?: number;
  /** Easy runs targeted by pace or by heart rate. Zone 2 plans are always HR. */
  easyBy: 'pace' | 'hr';
  /**
   * Default session mode for generated runs. Onboarding no longer asks and passes 'none';
   * the pre-start screen picks outdoor, treadmill or timer for each run.
   */
  treadmill: 'none' | 'some' | 'mostly';
  /** Where you are now. Sets the first week's volume; omitted uses the preset's defaults. */
  fitness?: StartingFitness;
}

/** Current running, as Runna asks it. SI units. */
export interface StartingFitness {
  /** Runs per week lately, 0-7. */
  runsPerWeek: number;
  /** Typical weekly running distance lately. */
  weeklyDistanceM: number;
  /** Longest run in the last month. */
  longestRunM: number;
  /** A recent race or time trial. Sets training paces (current fitness, not goal). */
  recentRace?: { meters: number; seconds: number };
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
  /** Starters ship with the catalog and are read-only; duplicate to edit. */
  origin: 'starter' | 'custom';
}

export interface RoutineDetail extends Routine {
  items: RoutineItems;
  notes?: string;
}

export interface RoutineInput {
  name: string;
  items: RoutineItems;
  notes?: string;
}

export interface ExerciseSummary {
  id: string;
  slug: string;
  name: string;
  kind: ExerciseKind;
  musclePrimary: Muscle;
  equipment: Equipment;
  tracking: Tracking;
  sides: 'both' | 'none';
  defaultHoldS?: number;
  /** Thumbnail key ("cat-stretch"), absent for custom exercises. */
  thumbKey?: string;
  custom: boolean;
}

export interface ExerciseFilter {
  kind?: ExerciseKind;
  muscle?: Muscle;
  equipment?: Equipment;
  /** Matches name and aliases, case-insensitive. */
  query?: string;
  includeHidden?: boolean;
}

export interface CustomExerciseInput {
  name: string;
  kind: ExerciseKind;
  musclePrimary: Muscle;
  equipment: Equipment;
  tracking: Tracking;
  sides?: 'both' | 'none';
  defaultHoldS?: number;
  note?: string;
}

export interface StrengthSessionInput {
  name: string;
  routineId?: string;
  /** Agenda key of the scheduled occurrence this completes. */
  scheduleKey?: string;
  startedAt: string;
  endedAt: string;
  sets: (LoggedSet & { completedAt: string })[];
  rpe?: number;
  notes?: string;
}

export interface ExerciseHistoryEntry {
  sessionId: string;
  date: IsoDate;
  sets: LoggedSet[];
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
  /** Voice cues on or off (spec §5 Audio cues). */
  voice: boolean;
  cues: CuePrefs;
  /** Auto-pause outdoors (spec §5). */
  autoPause: boolean;
  /** Keep auto-pause during walk steps. */
  autoPauseOnWalks: boolean;
  /** Offer "Post-run stretch?" on fresh run summaries (spec §10). */
  postRunStretch: boolean;
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
  /** Wall-clock pause ranges; pass to splits() and mark as gaps in replay. */
  pauses: [number, number][];
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

  // Workouts and paces
  workout(id: string): Workout | undefined;
  /** VDOT of the current pace profile, for zonePace() ranges. */
  currentVdot(): number | undefined;

  // Sessions
  startSession(input: SessionStartInput): string;
  saveProgress(id: string, progress: SessionProgress): void;
  finishSession(id: string, finish: SessionFinish): void;
  discardSession(id: string): void;
  activeSession(): ActiveSession | undefined;
  session(id: string): SessionDetail | undefined;
  recentSessions(limit: number): SessionListItem[];
  updateSessionNotes(id: string, patch: { rpe?: number; notes?: string }): void;

  // Exercise catalog (M1.5). Seed after first paint, only when CATALOG_VERSION differs.
  catalogVersion(): string | undefined;
  /** Upserts seed exercises (keeps hidden flags and custom rows) and starter routines in one transaction. */
  seedCatalog(catalog: Catalog): void;
  exercises(filter?: ExerciseFilter): ExerciseSummary[];
  exercise(id: string): (Exercise & { custom: boolean; hidden: boolean; note?: string }) | undefined;
  addCustomExercise(input: CustomExerciseInput): ExerciseSummary;
  setExerciseHidden(id: string, hidden: boolean): void;

  // Routine library
  routine(id: string): RoutineDetail | undefined;
  createRoutine(input: RoutineInput): string;
  /** Throws for starter routines. */
  updateRoutine(id: string, input: RoutineInput): void;
  duplicateRoutine(id: string, name: string): string;
  /** Soft-deletes and ends its schedule entries, keeping past completions. */
  deleteRoutine(id: string): void;

  // Strength logging
  /** Sets from the most recent saved session that included each exercise, for prefill. */
  lastSets(exerciseIds: readonly string[]): Record<string, LoggedSet[]>;
  /** Saves the session and its sets, and marks the scheduled occurrence done (Done + data). */
  saveStrengthSession(input: StrengthSessionInput): string;
  exerciseHistory(exerciseId: string, limit: number): ExerciseHistoryEntry[];

  // Settings
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
}
