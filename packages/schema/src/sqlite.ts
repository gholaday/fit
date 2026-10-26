import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Local SQLite schema (spec §13), M0 subset. Conventions:
 * - ids are ULIDs (text), except `settings` which is keyed by name
 * - calendar dates are ISO text ("2026-10-26"); instants are epoch ms integers
 * - every synced table has updated_at, deleted_at (soft delete) and a local dirty flag
 * - SI units only (meters, seconds, kg)
 * The pg-core mirror for Neon sync lands in M2.5 with a parity test.
 */

const syncColumns = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(true),
};

const bool = (name: string) => integer(name, { mode: 'boolean' });

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(true),
});

export const hrProfiles = sqliteTable(
  'hr_profiles',
  {
    id: text('id').primaryKey(),
    method: text('method', { enum: ['hrr', 'max', 'maf', 'lthr', 'custom'] }).notNull(),
    maxHr: integer('max_hr'),
    maxHrSource: text('max_hr_source', { enum: ['measured', 'estimated'] }),
    restingHr: integer('resting_hr'),
    lthr: integer('lthr'),
    age: integer('age'),
    /** Input extras (MAF adjust, custom ranges) and computed zones. */
    inputJson: text('input_json').notNull(),
    zonesJson: text('zones_json').notNull(),
    isCurrent: bool('is_current').notNull(),
    ...syncColumns,
  },
  (t) => [index('hr_profiles_current').on(t.isCurrent)],
);

export const paceProfiles = sqliteTable(
  'pace_profiles',
  {
    id: text('id').primaryKey(),
    vdot: real('vdot').notNull(),
    source: text('source', { enum: ['trial', 'race', 'manual', 'goal'] }).notNull(),
    sourceDetailJson: text('source_detail_json'),
    isCurrent: bool('is_current').notNull(),
    ...syncColumns,
  },
  (t) => [index('pace_profiles_current').on(t.isCurrent)],
);

export const workouts = sqliteTable('workouts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['run', 'strength', 'mobility', 'mixed'] }).notNull(),
  defaultMode: text('default_mode', { enum: ['outdoor', 'treadmill', 'timer'] }).notNull(),
  /** `{ schemaVersion, items }` */
  itemsJson: text('items_json').notNull(),
  notes: text('notes'),
  isTemplate: bool('is_template').notNull().default(false),
  ...syncColumns,
});

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    presetId: text('preset_id').notNull(),
    name: text('name').notNull(),
    inputsJson: text('inputs_json').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    status: text('status', { enum: ['active', 'done', 'abandoned'] }).notNull(),
    ...syncColumns,
  },
  (t) => [index('plans_status').on(t.status)],
);

export const planWorkouts = sqliteTable(
  'plan_workouts',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id').notNull(),
    workoutId: text('workout_id').notNull(),
    date: text('date').notNull(),
    originalDate: text('original_date').notNull(),
    weekIndex: integer('week_index').notNull(),
    role: text('role').notNull(),
    status: text('status', { enum: ['scheduled', 'done', 'missed', 'skipped', 'moved'] }).notNull(),
    completedAt: integer('completed_at'),
    manualMinutes: real('manual_minutes'),
    manualDistanceM: real('manual_distance_m'),
    manualRpe: integer('manual_rpe'),
    manualNote: text('manual_note'),
    skipReason: text('skip_reason', { enum: ['sick', 'busy', 'sore', 'other'] }),
    sessionId: text('session_id'),
    /** Watch workout linked from the new-activity modal (Done + data, no phone session). */
    externalSessionId: text('external_session_id'),
    ...syncColumns,
  },
  (t) => [index('plan_workouts_date').on(t.date), index('plan_workouts_plan').on(t.planId, t.date), index('plan_workouts_sync').on(t.dirty, t.updatedAt)],
);

export const planEvents = sqliteTable(
  'plan_events',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id').notNull(),
    planWorkoutId: text('plan_workout_id'),
    type: text('type').notNull(),
    message: text('message').notNull(),
    ...syncColumns,
  },
  (t) => [index('plan_events_plan').on(t.planId)],
);

export const routines = sqliteTable('routines', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['strength', 'stretch'] }).notNull(),
  name: text('name').notNull(),
  folder: text('folder'),
  /** Strength: exercise targets. Stretch: moves with hold_s, sides. Full shape lands in M1.5. */
  itemsJson: text('items_json').notNull(),
  notes: text('notes'),
  origin: text('origin', { enum: ['starter', 'custom'] }).notNull(),
  /** Catalog slug for starter routines, so re-seeding updates them in place. */
  starterSlug: text('starter_slug'),
  ...syncColumns,
});

export const weeklySchedule = sqliteTable(
  'weekly_schedule',
  {
    id: text('id').primaryKey(),
    weekday: integer('weekday').notNull(),
    routineId: text('routine_id').notNull(),
    slot: text('slot', { enum: ['morning', 'evening', 'any'] }),
    time: text('time'),
    reminder: bool('reminder').notNull().default(false),
    position: integer('position').notNull(),
    /** Inclusive validity window, so "Change the schedule" never rewrites past weeks. */
    startsOn: text('starts_on'),
    endsOn: text('ends_on'),
    ...syncColumns,
  },
  (t) => [index('weekly_schedule_weekday').on(t.weekday)],
);

export const scheduleOverrides = sqliteTable(
  'schedule_overrides',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id').notNull(),
    originalDate: text('original_date').notNull(),
    /** null removes this occurrence. */
    newDate: text('new_date'),
    ...syncColumns,
  },
  (t) => [uniqueIndex('schedule_overrides_occurrence').on(t.scheduleId, t.originalDate), index('schedule_overrides_new_date').on(t.newDate)],
);

export const routineCompletions = sqliteTable(
  'routine_completions',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id').notNull(),
    scheduleId: text('schedule_id'),
    /** Original date of the scheduled occurrence. */
    date: text('date').notNull(),
    status: text('status', { enum: ['done', 'skipped'] }).notNull(),
    completedAt: integer('completed_at'),
    detailsJson: text('details_json'),
    skipReason: text('skip_reason', { enum: ['sick', 'busy', 'sore', 'other'] }),
    itemsDoneJson: text('items_done_json'),
    sessionId: text('session_id'),
    externalSessionId: text('external_session_id'),
    ...syncColumns,
  },
  (t) => [index('routine_completions_date').on(t.date), uniqueIndex('routine_completions_occurrence').on(t.scheduleId, t.date)],
);

export const quickLogs = sqliteTable(
  'quick_logs',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    activityType: text('activity_type').notNull(),
    minutes: real('minutes').notNull(),
    distanceM: real('distance_m'),
    note: text('note'),
    ...syncColumns,
  },
  (t) => [index('quick_logs_date').on(t.date)],
);


export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id'),
    planWorkoutId: text('plan_workout_id'),
    /** Strength sessions: the routine that was logged. */
    routineId: text('routine_id'),
    name: text('name').notNull(),
    mode: text('mode', { enum: ['outdoor', 'treadmill', 'timer'] }).notNull(),
    status: text('status', { enum: ['active', 'saved', 'discarded'] }).notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    elapsedMs: integer('elapsed_ms').notNull().default(0),
    pausedMs: integer('paused_ms').notNull().default(0),
    distanceM: real('distance_m').notNull().default(0),
    avgPaceSPerKm: real('avg_pace_s_per_km'),
    rpe: integer('rpe'),
    notes: text('notes'),
    paceProfileId: text('pace_profile_id'),
    hrProfileId: text('hr_profile_id'),
    /** Player state, saved every 5 s while active for crash recovery; final log after. */
    playerJson: text('player_json').notNull(),
    summaryJson: text('summary_json'),
    /** When Health Connect HR was last added; -1 when none should be (after "Undo", or a gap-free live trace). */
    hrFilledAt: integer('hr_filled_at'),
    ...syncColumns,
  },
  (t) => [index('sessions_status').on(t.status), index('sessions_started').on(t.startedAt), index('sessions_plan_workout').on(t.planWorkoutId)],
);

export const sessionSteps = sqliteTable(
  'session_steps',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    idx: integer('idx').notNull(),
    /** Snapshot of the planned step, so editing a template never rewrites history. */
    stepJson: text('step_json').notNull(),
    startedAtOffsetMs: integer('started_at_offset_ms').notNull(),
    endedAtOffsetMs: integer('ended_at_offset_ms').notNull(),
    activeMs: integer('active_ms').notNull(),
    distanceM: real('distance_m').notNull(),
    avgPaceSPerKm: real('avg_pace_s_per_km'),
    treadmillSpeedKph: real('treadmill_speed_kph'),
    skipped: integer('skipped', { mode: 'boolean' }).notNull(),
    ...syncColumns,
  },
  (t) => [index('session_steps_session').on(t.sessionId, t.idx)],
);

/**
 * Raw GPS points, local only. They sync later as one blob per session
 * (`session_tracks` on the server, spec §17), so no per-row sync columns.
 */
export const trackPoints = sqliteTable(
  'track_points',
  {
    sessionId: text('session_id').notNull(),
    tOffsetMs: integer('t_offset_ms').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    alt: real('alt'),
    accuracy: real('accuracy').notNull(),
    speed: real('speed'),
    source: text('source', { enum: ['phone', 'health_connect', 'file'] }).notNull().default('phone'),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.tOffsetMs] })],
);

export const exercises = sqliteTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['strength', 'stretch', 'cardio', 'plyometric'] }).notNull(),
    musclePrimary: text('muscle_primary').notNull(),
    musclesSecondaryJson: text('muscles_secondary_json').notNull(),
    equipment: text('equipment').notNull(),
    tracking: text('tracking', { enum: ['weight_reps', 'reps', 'time', 'distance'] }).notNull(),
    level: text('level').notNull(),
    instructionsJson: text('instructions_json').notNull(),
    imageKeysJson: text('image_keys_json').notNull(),
    sides: text('sides', { enum: ['both', 'none'] }).notNull(),
    defaultHoldS: integer('default_hold_s'),
    aliasesJson: text('aliases_json').notNull(),
    /** Lowercased name and aliases, for search without functions in the query. */
    searchText: text('search_text').notNull(),
    origin: text('origin', { enum: ['seed', 'custom'] }).notNull(),
    sourceRef: text('source_ref'),
    dataVersion: text('data_version'),
    note: text('note'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    ...syncColumns,
  },
  (t) => [uniqueIndex('exercises_slug').on(t.slug), index('exercises_kind').on(t.kind, t.hidden)],
);

export const strengthSets = sqliteTable(
  'strength_sets',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    exerciseId: text('exercise_id').notNull(),
    setIdx: integer('set_idx').notNull(),
    type: text('type', { enum: ['normal', 'warmup'] }).notNull().default('normal'),
    reps: integer('reps').notNull(),
    weightKg: real('weight_kg'),
    durationS: integer('duration_s'),
    completedAt: integer('completed_at').notNull(),
    ...syncColumns,
  },
  (t) => [index('strength_sets_session').on(t.sessionId), index('strength_sets_exercise').on(t.exerciseId, t.completedAt)],
);

// M2: heart rate and Health Connect (spec §7, §11).

/** Per-session HR trace. Live BLE samples are written with saveProgress; Health Connect samples replace each other. */
export const hrSamples = sqliteTable(
  'hr_samples',
  {
    sessionId: text('session_id').notNull(),
    tOffsetMs: integer('t_offset_ms').notNull(),
    bpm: integer('bpm').notNull(),
    source: text('source', { enum: ['ble', 'health_connect'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.source, t.tOffsetMs] })],
);

export const dailyMetrics = sqliteTable('daily_metrics', {
  date: text('date').primaryKey(),
  steps: integer('steps'),
  restingHr: integer('resting_hr'),
  activeKcal: real('active_kcal'),
  sleepMin: integer('sleep_min'),
  source: text('source').notNull(),
  syncedAt: integer('synced_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(true),
});

export const externalSessions = sqliteTable(
  'external_sessions',
  {
    id: text('id').primaryKey(),
    hcRecordId: text('hc_record_id').notNull(),
    originPackage: text('origin_package').notNull(),
    activity: text('activity').notNull(),
    title: text('title').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    distanceM: real('distance_m'),
    activeKcal: real('active_kcal'),
    avgHr: integer('avg_hr'),
    maxHr: integer('max_hr'),
    hasRoute: bool('has_route').notNull().default(false),
    rpe: integer('rpe'),
    note: text('note'),
    /** new: waiting in the modal; saved: linked to the plan or unplanned; merged into a phone session; ignored. */
    status: text('status', { enum: ['new', 'saved', 'merged', 'ignored'] }).notNull(),
    linkedSessionId: text('linked_session_id'),
    /** Agenda key the save completed, for undo. */
    linkedPlanKey: text('linked_plan_key'),
    ...syncColumns,
  },
  (t) => [uniqueIndex('external_sessions_hc').on(t.hcRecordId), index('external_sessions_status').on(t.status), index('external_sessions_started').on(t.startedAt)],
);

export const hcSyncState = sqliteTable('hc_sync_state', {
  key: text('key').primaryKey(),
  changesToken: text('changes_token'),
  lastSyncedAt: integer('last_synced_at'),
});
