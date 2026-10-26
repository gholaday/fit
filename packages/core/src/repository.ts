import type { AgendaItem, CompletionDetails, ScheduleSlot, SkipReason } from './agenda';
import type { IsoDate, Weekday } from './dates';
import type { HrProfileInput, HrZoneBand } from './hr';
import type { ExternalActivity, PlanMatch } from './external';
import type { CuePrefs } from './session/cues';
import type { HrSample } from './session/heart';
import type { TreadmillPrefs } from './session/treadmill';
import type { TrackPoint } from './session/geo';
import type { PlayerState, StepLogEntry } from './session/player';
import type { StepResult } from './session/track';
import type { UnitPrefs } from './units';
import type { Catalog, Equipment, Exercise, ExerciseKind, Muscle, Tracking } from './exercise';
import type { LoggedSet, RoutineItems } from './routine';
import type { SessionMode, StructureSegment, Workout, WorkoutItem } from './workout';

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

export interface WorkoutInput {
  name: string;
  items: WorkoutItem[];
  defaultMode: SessionMode;
  notes?: string;
  template: boolean;
}

export interface WorkoutSummary {
  id: string;
  name: string;
  defaultMode: SessionMode;
  /** From the current pace profile, or rough defaults without one. */
  estSeconds: number;
  estMeters: number;
  structure: StructureSegment[];
  updatedAt: string;
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
  /** Remembered BLE heart-rate sensor, reconnected at session start (spec §7). */
  hrSensor?: { id: string; name: string };
  healthConnect: HealthConnectPrefs;
  /** Remembered treadmill speeds (spec §5 Treadmill, "remember last"). */
  treadmill: TreadmillPrefs;
}

/** Spec §11 Settings. */
export interface HealthConnectPrefs {
  /** Import watch workouts (new-activity modal). */
  importWorkouts: boolean;
  /** Add watch HR to phone sessions. */
  addHr: boolean;
  /** Write Fit sessions to Health Connect. Off by default to avoid duplicates. */
  writeSessions: boolean;
  /** Import from every app, not only Garmin Connect. */
  allSources: boolean;
  /** Link without asking when there is exactly one strong plan match. */
  autoMatch: boolean;
}

export const GARMIN_CONNECT_PACKAGE = 'com.garmin.android.apps.connectmobile';

// Health Connect (M2). The app reads Health Connect and hands normalized records to the
// repository; the repository decides merges, matches and storage. Instants are ISO strings.

export interface DailyMetricsInput {
  date: IsoDate;
  steps?: number;
  restingHr?: number;
  activeKcal?: number;
  sleepMin?: number;
  /** Origin package of the records. */
  source: string;
}

export interface DailyMetrics extends DailyMetricsInput {
  syncedAt: string;
}

export interface ExternalSessionInput {
  hcRecordId: string;
  originPackage: string;
  activity: ExternalActivity;
  /** Health Connect title, if any; otherwise one is made from the activity. */
  title?: string;
  startedAt: string;
  endedAt: string;
  distanceM?: number;
  activeKcal?: number;
  avgHr?: number;
  maxHr?: number;
  hasRoute: boolean;
}

export interface ExternalSession extends Omit<ExternalSessionInput, 'title'> {
  id: string;
  title: string;
  status: 'new' | 'saved' | 'merged' | 'ignored';
  rpe?: number;
  note?: string;
  /** Merged into this phone session. */
  linkedSessionId?: string;
  /** Agenda item the save completed. */
  linkedPlanKey?: string;
}

export interface HealthImportResult {
  /** Watch sessions merged into phone sessions: "Added Garmin heart rate to ...". */
  merged: { externalId: string; sessionId: string; sessionName: string }[];
  /** New sessions for the modal (status new), or saved when auto-matched. */
  added: ExternalSession[];
}

/** A saved phone session whose time window still needs Health Connect HR. */
export interface HrWindow {
  sessionId: string;
  startedAt: string;
  endedAt: string;
}

export interface ExternalSave {
  /** Agenda key to complete; omitted for "Not part of my plan". */
  planKey?: string;
  title: string;
  activity: ExternalActivity;
  rpe?: number;
  note?: string;
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
  /** Live BLE samples since the last save. */
  hr?: HrSample[];
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
  /** Live samples with Health Connect filling dropouts (mergeHr); pass to hrStats(). */
  hr: HrSample[];
  /** Health Connect HR has been added (summary banner "Heart rate added from Garmin"). */
  hrFromHealth: boolean;
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
  /** Saved run workouts (templates), most recently edited first (spec §4, M4). */
  workoutLibrary(): WorkoutSummary[];
  /**
   * Creates (no id) or updates a workout. `template: false` stores a one-off for "Start now"
   * without saving, so the session still links to its workout. Returns the id.
   */
  saveWorkout(input: WorkoutInput, id?: string): string;
  /** Copies any workout (a plan workout too) into the library. */
  duplicateWorkout(id: string, name: string): string;
  /** Soft-deletes a template; past sessions keep their step snapshots. */
  deleteWorkout(id: string): void;
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
  /**
   * "Treadmill says X km" or Timer's manual distance: sets the total and rescales every
   * step's distance (rescaleLog) and the average pace.
   */
  correctDistance(id: string, totalM: number): void;
  /** Rename, e.g. to the autoTitle() for free runs. */
  renameSession(id: string, name: string): void;

  /** Route for a watch-only run from a GPX file (parseGpx); replaces any earlier one. */
  attachExternalRoute(externalId: string, points: readonly TrackPoint[]): void;
  externalRoute(externalId: string): TrackPoint[];

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

  // Health Connect (M2). Sync runs on app open, pull-to-refresh and after a save.
  healthSyncState(): { changesToken?: string; lastSyncedAt?: string };
  setHealthSyncState(state: { changesToken?: string; lastSyncedAt: string }): void;
  upsertDailyMetrics(rows: readonly DailyMetricsInput[]): void;
  dailyMetrics(date: IsoDate): DailyMetrics | undefined;
  /** Idempotent by hcRecordId. Merges watch sessions overlapping a phone session by more than half. */
  importExternalSessions(inputs: readonly ExternalSessionInput[]): HealthImportResult;
  /** Saved phone sessions from `since` on that have live HR dropouts (or none) and no Health Connect HR yet. */
  sessionsNeedingHr(since: string): HrWindow[];
  /** Replaces the session's Health Connect samples. Empty input is a no-op, so the next sync retries. */
  addHealthHr(sessionId: string, samples: readonly { time: string; bpm: number }[]): void;
  pendingExternal(): ExternalSession[];
  /** Saved watch activities whose local start date is in [start, end], oldest first. */
  externalSessions(start: IsoDate, end: IsoDate): ExternalSession[];
  externalSession(id: string): ExternalSession | undefined;
  planMatch(externalId: string): PlanMatch;
  saveExternal(id: string, save: ExternalSave): void;
  ignoreExternal(id: string): void;
  /** Undo of a merge: drops the Health Connect HR it added and shows it in the modal instead. */
  undoMerge(externalId: string): void;

  // Settings
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
}
