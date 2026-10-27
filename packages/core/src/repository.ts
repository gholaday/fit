import type { AgendaItem, CompletionDetails, ScheduleSlot, SkipReason } from './agenda';
import type { IsoDate, Weekday } from './dates';
import type { HrProfileInput, HrZoneBand } from './hr';
import type { ExternalActivity, PlanMatch } from './external';
import type { TrialResult } from './pace';
import type { PersonalBest, RunRow, SessionStats } from './stats';
import type { LiftBests, RecordEvent } from './records';
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

export type PlanPresetId =
  | '5k-8wk'
  | '10k-10wk'
  | 'half-12wk'
  | 'c25k-9wk'
  | 'walk-to-run-6wk'
  | 'base-builder'
  | 'speed-6wk'
  | 'z2-base-8wk'
  | 'z2-run-walk-6wk'
  | 'z2-walk-4wk'
  | 'z2-speed-8wk';

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
  /** Fitness plans: one of presetInfo().weeksOptions; omitted uses the preset length. */
  weeks?: number;
  /**
   * Wizard step 5 (spec §8): race uses fitness.recentRace; trial puts a 3 km time trial in
   * week 1; beginner turns pace targets into effort. Omitted behaves like race or goal.
   */
  paceSource?: 'race' | 'trial' | 'beginner';
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

export interface PlanEvent {
  id: string;
  planWorkoutId?: string;
  type: string;
  message: string;
  createdAt: string;
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

export interface PaceProfileInput {
  vdot: number;
  source: 'trial' | 'race' | 'manual';
  /** The race or trial it came from. */
  detail?: { meters: number; seconds: number };
  sessionId?: string;
}

export interface PaceProfile {
  id: string;
  vdot: number;
  source: 'trial' | 'race' | 'manual' | 'goal';
  detail?: { meters: number; seconds: number; sessionId?: string };
  createdAt: string;
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

export interface StrengthSessionDetail {
  id: string;
  name: string;
  routineId?: string;
  startedAt: string;
  endedAt: string;
  rpe?: number;
  notes?: string;
  sets: (LoggedSet & { completedAt: string })[];
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

export type HistoryKind = 'run' | 'walk' | 'strength' | 'stretch' | 'other';

/** One row of the History list: a session recorded in Fit or a saved watch activity. */
export interface HistoryItem {
  id: string;
  source: 'fit' | 'external';
  kind: HistoryKind;
  /** Fit sessions only. */
  mode?: SessionMode;
  name: string;
  startedAt: string;
  durationS: number;
  distanceM?: number;
  /** External sessions: the app that recorded it, e.g. com.garmin.android.apps.connectmobile. */
  originPackage?: string;
}

export interface HistoryFilter {
  kind?: HistoryKind;
  mode?: SessionMode;
  source?: 'fit' | 'external';
  /** Case-insensitive match on the name. */
  search?: string;
  /** Paging: only items that started before this ISO time. */
  before?: string;
  limit: number;
}

export interface StrengthDay {
  sessionId: string;
  date: IsoDate;
  routineId?: string;
  volumeKg: number;
}

/** One aerobic test (30 min at a fixed HR, spec §7): pace or belt speed at that HR. */
export interface AerobicTest {
  sessionId: string;
  date: IsoDate;
  mode: SessionMode;
  durationS: number;
  /** Pace over the test step (treadmill: from the belt speed). */
  secPerKm?: number;
  avgBpm?: number;
}

export interface RoutineDay {
  routineId: string;
  date: IsoDate;
  /** From "Done + details", when given. */
  minutes?: number;
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
  /** Saved runs: distance split, Zone 2, decoupling, run/walk and best efforts. */
  stats?: SessionStats;
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
  deleteQuickLog(id: string): void;

  // Heart rate
  currentHrProfile(): HrProfile | undefined;
  saveHrProfile(input: HrProfileInput): HrProfile;

  // Running plan
  activePlan(today: IsoDate): PlanSummary | undefined;
  createPlan(inputs: PlanInputs, today: IsoDate): PlanSummary;
  abandonPlan(planId: string): void;
  /**
   * Applies the adaptation rules (adaptPlan) to the active plan and logs plan events.
   * Call on plan open (it runs at most once a day), after a save and after a move.
   */
  adaptPlan(today: IsoDate, opts?: { force?: boolean }): { events: PlanEvent[]; rebuildPrompt: boolean };
  /** Recent adaptation banners, newest first ("Moved Tempo run to Friday."). */
  planEvents(limit: number): PlanEvent[];
  /** Plan menu: pending workouts from `from` to Sunday move one day later. */
  shiftRestOfWeek(from: IsoDate): void;
  /** Plan menu: every pending workout from `from` on moves a week later (travel, sick). */
  pushPlanBack(from: IsoDate): void;
  /**
   * Change run days without rebuilding: upcoming runs move to their role's new weekday in
   * the same week. Same runs per week; throws when the days cannot hold them.
   */
  changeRunDays(preferredDays: readonly Weekday[], longRunDay: Weekday, from: IsoDate): void;
  /** "Rebuild plan from here?": a new plan with the same inputs, starting today. */
  rebuildPlan(today: IsoDate): PlanSummary;

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

  // Pace profile (M5, spec §6). History is kept; plan workouts store zones, so a new
  // profile updates every future target at once.
  paceProfile(): PaceProfile | undefined;
  paceHistory(): PaceProfile[];
  setPaceProfile(input: PaceProfileInput): PaceProfile;
  /** Trial result of a saved session (trialResult over its steps), for "Update your paces?". */
  sessionTrial(sessionId: string): TrialResult | undefined;
  /** "Keep current" on the trial card: that session stops offering its trial. */
  dismissTrial(sessionId: string): void;
  /** +1 VDOT prompt from sessions since the current profile and the last dismissal. */
  paceBump(): { from: number; to: number } | undefined;
  dismissPaceBump(): void;

  // Sessions
  startSession(input: SessionStartInput): string;
  saveProgress(id: string, progress: SessionProgress): void;
  finishSession(id: string, finish: SessionFinish): void;
  discardSession(id: string): void;
  /**
   * Deletes a saved session (Discard on a summary, or delete from Today). A plan workout
   * it completed goes back to scheduled, and watch HR merged into it is offered again.
   */
  deleteSession(id: string): void;
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
  /** Visible exercises and how many of them are yours, without loading the rows. */
  exerciseCounts(): { total: number; custom: number };
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
  /** A saved strength session with its sets in logged order, for the lift detail screen. */
  strengthSession(id: string): StrengthSessionDetail | undefined;
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
  /** Delete from Today: hides a saved watch activity (as Ignore does) and reopens the plan workout it completed. */
  deleteExternal(id: string): void;
  /** Undo of a merge: drops the Health Connect HR it added and shows it in the modal instead. */
  undoMerge(externalId: string): void;

  // Stats and history (M9, spec §12)
  /** Saved runs (Fit and imported run, treadmill, walk and hike) by local date in [start, end], oldest first. */
  runRows(start: IsoDate, end: IsoDate): RunRow[];
  /** Fastest 1 km, 1 mi, 5 km, 10 km and half from every outdoor Fit run. */
  personalBests(): PersonalBest[];
  /** Newest first. */
  history(filter: HistoryFilter): HistoryItem[];
  dailyMetricsRange(start: IsoDate, end: IsoDate): DailyMetrics[];
  strengthDays(start: IsoDate, end: IsoDate): StrengthDay[];
  /** Routines marked done, by the occurrence date, in [start, end]. */
  routineDays(start: IsoDate, end: IsoDate): RoutineDay[];
  /** Recorded plan retests with a 20 min or longer HR step, oldest first (spec §7 Progress). */
  aerobicTests(): AerobicTest[];
  /** Typical pace in Zone 2 from recent outdoor runs, the target when there is no live HR (spec §7). */
  learnedZone2Pace(today: IsoDate): number | undefined;

  // Records (Hevy-style trophies): derived from saved runs and sets, never stored.
  /** The standing record for every key, runs and lifts. */
  records(): RecordEvent[];
  /** Records worth a trophy (improvements and firsts), newest first. */
  recentRecords(limit: number): RecordEvent[];
  /** Trophies a session earned: Fit run, strength session or watch activity. */
  sessionRecords(sessionId: string): RecordEvent[];
  /** Every record event of one exercise, oldest first, for its history. */
  exerciseRecords(exerciseId: string): RecordEvent[];
  /** Current lift bests per exercise, for setRecords() while logging. */
  liftBests(exerciseIds: readonly string[]): Record<string, LiftBests>;

  // Settings
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
}
