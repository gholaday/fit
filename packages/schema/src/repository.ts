import {
  addDays,
  buildAgenda,
  computeZones,
  diffDays,
  generatePlan,
  parseOccurrenceKey,
  presetInfo,
  rescheduleEntry,
  startOfWeek,
  structureSegments,
  totalMeters,
  totalSeconds,
  type WorkoutInput,
  WORKOUT_ITEMS_SCHEMA_VERSION,
  z2Minutes,
  zonePace,
  type AgendaItem,
  type Clock,
  type CompletionDetails,
  type FitRepository,
  type HealthImportResult,
  type HrProfile,
  type HrProfileInput,
  type HrZoneBand,
  type IdGen,
  type IsoDate,
  type PaceLookup,
  type PlanInputs,
  type PlanPresetId,
  type PlanRole,
  type PlanSummary,
  type PlanWorkoutRow,
  type QuickLog,
  type QuickLogType,
  type Routine,
  type RoutineInfo,
  type ScheduleEntry,
  type ScheduleRow,
  type Settings,
  type SkipReason,
  type Weekday,
  type WorkoutItem,
  type Workout,
  type ActiveSession,
  type PlayerState,
  type SessionDetail,
  type SessionListItem,
  type TrackPoint,
  type Equipment,
  type Exercise,
  type ExerciseHistoryEntry,
  type ExerciseSummary,
  type Level,
  type LoggedSet,
  type Muscle,
  type RoutineDetail,
  type RoutineItems,
  type DailyMetrics,
  type ExternalActivity,
  type ExternalSession,
  type HrSample,
  type HrWindow,
  DEFAULT_CUE_PREFS,
  findMergeTarget,
  GARMIN_CONNECT_PACKAGE,
  hrGaps,
  DEFAULT_TREADMILL,
  localIsoDate,
  matchPlanItem,
  mergeHr,
  rescaleLog,
  adaptPlan as adaptPlanRules,
  isHardWorkout,
  scaleItems,
  shiftRestOfWeek as shiftRestOfWeekRule,
  type AdaptItem,
  type PlanEvent,
  trialResult,
  vdotBumpSuggestion,
  type PaceProfile,
  routineSeconds,
  stepResults,
  volumeKg,
  cumulativeDistance,
  personalBests as fastestEfforts,
  sessionStats,
  SESSION_STATS_VERSION,
  learnedZone2Pace as medianZone2Pace,
  type AerobicTest,
  type HistoryItem,
  type HistoryKind,
  type RunRow,
  type SessionStats,
} from '@fit/core';
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNull, like, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as t from './sqlite';

/** Any synchronous Drizzle SQLite database (expo-sqlite on device, better-sqlite3 in node). */
export type FitDb = BaseSQLiteDatabase<'sync', unknown, typeof t>;

export interface RepositoryDeps {
  clock: Clock;
  newId: IdGen;
}

const DEFAULT_SETTINGS: Settings = {
  units: { distance: 'mi', weight: 'lb' },
  stepGoal: 8000,
  easyBy: 'pace',
  onboarded: false,
  voice: true,
  cues: DEFAULT_CUE_PREFS,
  autoPause: false,
  autoPauseOnWalks: true,
  postRunStretch: true,
  healthConnect: { importWorkouts: true, addHr: true, writeSessions: false, allSources: false, autoMatch: false },
  treadmill: DEFAULT_TREADMILL,
};

const ACTIVITY_TITLES: Record<ExternalActivity, string> = {
  run: 'Run',
  treadmill: 'Treadmill run',
  walk: 'Walk',
  hike: 'Hike',
  bike: 'Ride',
  swim: 'Swim',
  strength: 'Strength',
  stretch: 'Stretch',
  other: 'Workout',
};

const dayStartMs = (d: IsoDate) => new Date(`${d}T00:00:00`).getTime();

const EXTERNAL_KIND: Record<ExternalActivity, HistoryKind> = {
  run: 'run',
  treadmill: 'run',
  walk: 'walk',
  hike: 'walk',
  bike: 'other',
  swim: 'other',
  strength: 'strength',
  stretch: 'stretch',
  other: 'other',
};
const EXTERNAL_RUNS: ExternalActivity[] = ['run', 'treadmill', 'walk', 'hike'];

function toExternal(r: typeof t.externalSessions.$inferSelect): ExternalSession {
  const e: ExternalSession = {
    id: r.id,
    hcRecordId: r.hcRecordId,
    originPackage: r.originPackage,
    activity: r.activity as ExternalActivity,
    title: r.title,
    startedAt: new Date(r.startedAt).toISOString(),
    endedAt: new Date(r.endedAt).toISOString(),
    hasRoute: r.hasRoute,
    status: r.status,
  };
  if (r.distanceM !== null) e.distanceM = r.distanceM;
  if (r.activeKcal !== null) e.activeKcal = r.activeKcal;
  if (r.avgHr !== null) e.avgHr = r.avgHr;
  if (r.maxHr !== null) e.maxHr = r.maxHr;
  if (r.rpe !== null) e.rpe = r.rpe;
  if (r.note !== null) e.note = r.note;
  if (r.linkedSessionId) e.linkedSessionId = r.linkedSessionId;
  if (r.linkedPlanKey) e.linkedPlanKey = r.linkedPlanKey;
  return e;
}

function toPaceProfile(r: typeof t.paceProfiles.$inferSelect): PaceProfile {
  const p: PaceProfile = { id: r.id, vdot: r.vdot, source: r.source, createdAt: new Date(r.createdAt).toISOString() };
  if (r.sourceDetailJson) {
    const d = JSON.parse(r.sourceDetailJson) as { meters?: number; seconds?: number; sessionId?: string };
    // Goal profiles from onboarding may lack a time (no goal entered).
    if (d.meters !== undefined && d.seconds !== undefined) p.detail = d as NonNullable<PaceProfile['detail']>;
  }
  return p;
}

const toHrSample = (r: typeof t.hrSamples.$inferSelect): HrSample => ({ tOffsetMs: r.tOffsetMs, bpm: r.bpm, source: r.source });

function toPlanEvent(r: typeof t.planEvents.$inferSelect): PlanEvent {
  const e: PlanEvent = { id: r.id, type: r.type, message: r.message, createdAt: new Date(r.createdAt).toISOString() };
  if (r.planWorkoutId) e.planWorkoutId = r.planWorkoutId;
  return e;
}

/** Rows per seed insert; 50 rows of ~24 columns stays far under SQLite's variable limit. */
const SEED_BATCH = 50;

/** Settings rows the repository keeps for itself; settings() leaves them out. */
const INTERNAL_SETTING_KEYS = new Set(['catalogVersion', 'paceBumpDismissedAt', 'planAdaptedOn', 'dismissedTrials']);

/** HR and route rows per insert (at most 8 columns each). */
const HR_BATCH = 200;

/** M0 rows stored names only. seedCatalog upgrades them in place, keeping their ids. */
interface LegacyRoutineItems {
  items: { name: string }[];
  estSeconds: number;
}

/** M0 starter names mapped to catalog starter slugs. */
const LEGACY_STARTERS: Record<string, string> = {
  Push: 'push',
  Pull: 'pull',
  Legs: 'legs',
  Morning: 'morning-wake-up',
  Evening: 'evening-wind-down',
  'Post-run': 'post-run',
};

function parseRoutineItems(json: string, kind: 'strength' | 'stretch'): RoutineItems {
  const parsed = JSON.parse(json) as RoutineItems | LegacyRoutineItems;
  if ('schemaVersion' in parsed) return parsed;
  // Not yet upgraded by seedCatalog: no exercise references to show.
  return kind === 'stretch' ? { schemaVersion: 2, kind, transitionS: 8, items: [] } : { schemaVersion: 2, kind, restS: 90, items: [] };
}

function routineStats(json: string): { itemCount: number; estSeconds: number } {
  const parsed = JSON.parse(json) as RoutineItems | LegacyRoutineItems;
  if ('schemaVersion' in parsed) return { itemCount: parsed.items.length, estSeconds: routineSeconds(parsed) };
  return { itemCount: parsed.items.length, estSeconds: parsed.estSeconds };
}

/** Strength sessions have no workout steps; a finished, empty player keeps session() uniform. */
const EMPTY_PLAYER: PlayerState = {
  steps: [],
  status: 'finished',
  pausedMs: 0,
  stepIdx: 0,
  stepStartActiveMs: 0,
  stepStartOffsetMs: 0,
  stepStartDistanceM: 0,
  log: [],
  pauses: [],
};

function toExercise(r: typeof t.exercises.$inferSelect): Exercise & { custom: boolean; hidden: boolean; note?: string } {
  const ex: Exercise & { custom: boolean; hidden: boolean; note?: string } = {
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    musclePrimary: r.musclePrimary as Muscle,
    musclesSecondary: JSON.parse(r.musclesSecondaryJson) as Muscle[],
    equipment: r.equipment as Equipment,
    tracking: r.tracking,
    level: r.level as Level,
    instructions: JSON.parse(r.instructionsJson) as string[],
    imageKeys: JSON.parse(r.imageKeysJson) as string[],
    sides: r.sides,
    aliases: JSON.parse(r.aliasesJson) as string[],
    custom: r.origin === 'custom',
    hidden: r.hidden,
  };
  if (r.defaultHoldS !== null) ex.defaultHoldS = r.defaultHoldS;
  if (r.note) ex.note = r.note;
  return ex;
}

function toSummary(r: typeof t.exercises.$inferSelect): ExerciseSummary {
  const s: ExerciseSummary = {
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    musclePrimary: r.musclePrimary as Muscle,
    equipment: r.equipment as Equipment,
    tracking: r.tracking,
    sides: r.sides,
    custom: r.origin === 'custom',
  };
  if (r.defaultHoldS !== null) s.defaultHoldS = r.defaultHoldS;
  return s;
}

/**
 * Lowercased words of the name and aliases, space-prefixed and with punctuation as
 * spaces, so `LIKE '% rdl%'` matches word starts ("RDL") but not "hurdle".
 */
const searchText = (name: string, aliases: readonly string[]) => ` ${[name, ...aliases].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')}`;

function toTrackPoint(r: typeof t.trackPoints.$inferSelect): TrackPoint {
  const p: TrackPoint = { tOffsetMs: r.tOffsetMs, lat: r.lat, lng: r.lng, accuracy: r.accuracy };
  if (r.alt !== null) p.alt = r.alt;
  if (r.speed !== null) p.speed = r.speed;
  return p;
}

const notDeleted = <T extends { deletedAt: unknown }>(table: T) => isNull(table.deletedAt as never);

export function createSqliteRepository(db: FitDb, { clock, newId }: RepositoryDeps): FitRepository {
  const now = () => clock().getTime();
  const today = () => localIsoDate(clock());
  const stamp = () => ({ updatedAt: now(), dirty: true });
  const created = () => {
    const ms = now();
    return { createdAt: ms, updatedAt: ms, dirty: true };
  };

  // -------------------------------------------------------------------------
  // Helpers

  function currentZones(): HrZoneBand[] | undefined {
    const row = db.select().from(t.hrProfiles).where(and(eq(t.hrProfiles.isCurrent, true), notDeleted(t.hrProfiles))).get();
    return row ? (JSON.parse(row.zonesJson) as HrZoneBand[]) : undefined;
  }

  function paceLookup(): PaceLookup | undefined {
    const row = db.select().from(t.paceProfiles).where(and(eq(t.paceProfiles.isCurrent, true), notDeleted(t.paceProfiles))).get();
    if (!row) return undefined;
    const vdot = row.vdot;
    return (step) => {
      const target = step.target;
      if (target.type === 'pace_zone') return zonePace(vdot, target.zone).targetSecPerKm;
      if (target.type === 'pace_range') return (target.minSecPerKm + target.maxSecPerKm) / 2;
      if (step.activity === 'run') return zonePace(vdot, 'easy').targetSecPerKm;
      return undefined;
    };
  }

  function routineMap(): Map<string, RoutineInfo & { itemCount: number; origin: 'starter' | 'custom' }> {
    const rows = db.select().from(t.routines).where(notDeleted(t.routines)).orderBy(asc(t.routines.name)).all();
    return new Map(rows.map((r) => [r.id, { name: r.name, kind: r.kind, origin: r.origin, ...routineStats(r.itemsJson) }]));
  }

  function scheduleRows(): (ScheduleRow & ScheduleEntry)[] {
    return db
      .select()
      .from(t.weeklySchedule)
      .where(notDeleted(t.weeklySchedule))
      .orderBy(asc(t.weeklySchedule.weekday), asc(t.weeklySchedule.position))
      .all()
      .map((r) => {
        const row: ScheduleRow & ScheduleEntry = {
          id: r.id,
          weekday: r.weekday as Weekday,
          routineId: r.routineId,
          reminder: r.reminder,
          position: r.position,
        };
        if (r.slot) row.slot = r.slot;
        if (r.time) row.time = r.time;
        if (r.startsOn) row.startsOn = r.startsOn;
        if (r.endsOn) row.endsOn = r.endsOn;
        return row;
      });
  }

  function completionDetails(d: CompletionDetails | undefined) {
    return {
      manualMinutes: d?.minutes ?? null,
      manualDistanceM: d?.distanceM ?? null,
      manualRpe: d?.rpe ?? null,
      manualNote: d?.note ?? null,
    };
  }

  function upsertCompletion(key: string, status: 'done' | 'skipped', extra: { completedAt?: number; details?: CompletionDetails; skipReason?: SkipReason; sessionId?: string; externalSessionId?: string }) {
    const occ = parseOccurrenceKey(key);
    if (!occ) throw new Error(`Not a schedule occurrence: ${key}`);
    const entry = db.select().from(t.weeklySchedule).where(eq(t.weeklySchedule.id, occ.scheduleId)).get();
    if (!entry) throw new Error(`Unknown schedule entry ${occ.scheduleId}`);
    const values = {
      status,
      completedAt: extra.completedAt ?? null,
      detailsJson: extra.details ? JSON.stringify(extra.details) : null,
      skipReason: extra.skipReason ?? null,
      sessionId: extra.sessionId ?? null,
      externalSessionId: extra.externalSessionId ?? null,
      deletedAt: null,
    };
    db.insert(t.routineCompletions)
      .values({ id: newId(), routineId: entry.routineId, scheduleId: occ.scheduleId, date: occ.originalDate, ...values, ...created() })
      .onConflictDoUpdate({ target: [t.routineCompletions.scheduleId, t.routineCompletions.date], set: { ...values, ...stamp() } })
      .run();
  }

  function moveOccurrence(scheduleId: string, originalDate: IsoDate, toDate: IsoDate) {
    db.insert(t.scheduleOverrides)
      .values({ id: newId(), scheduleId, originalDate, newDate: toDate, ...created() })
      .onConflictDoUpdate({
        target: [t.scheduleOverrides.scheduleId, t.scheduleOverrides.originalDate],
        set: { newDate: toDate, deletedAt: null, ...stamp() },
      })
      .run();
  }

  function moveKey(key: string, toDate: IsoDate) {
    const occ = parseOccurrenceKey(key);
    if (occ) moveOccurrence(occ.scheduleId, occ.originalDate, toDate);
    else db.update(t.planWorkouts).set({ date: toDate, ...stamp() }).where(eq(t.planWorkouts.id, key)).run();
  }

  function dateOfKey(key: string): IsoDate {
    const occ = parseOccurrenceKey(key);
    if (!occ) {
      const pw = db.select({ date: t.planWorkouts.date }).from(t.planWorkouts).where(eq(t.planWorkouts.id, key)).get();
      if (!pw) throw new Error(`Unknown plan workout ${key}`);
      return pw.date;
    }
    const o = db
      .select()
      .from(t.scheduleOverrides)
      .where(and(eq(t.scheduleOverrides.scheduleId, occ.scheduleId), eq(t.scheduleOverrides.originalDate, occ.originalDate), notDeleted(t.scheduleOverrides)))
      .get();
    return o?.newDate ?? occ.originalDate;
  }

  function planSummary(row: typeof t.plans.$inferSelect, onDate: IsoDate): PlanSummary {
    const inputs = JSON.parse(row.inputsJson) as PlanInputs;
    const info = presetInfo(row.presetId as PlanPresetId);
    const week1 = startOfWeek(row.startDate);
    // From the dates, so a chosen length or a repeated week (adaptPlan) counts.
    const weeks = Math.ceil((diffDays(week1, row.endDate) + 1) / 7);
    const currentWeek = Math.min(weeks, Math.max(1, Math.floor(diffDays(week1, onDate) / 7) + 1));
    const rows = db
      .select({ status: t.planWorkouts.status, itemsJson: t.workouts.itemsJson })
      .from(t.planWorkouts)
      .innerJoin(t.workouts, eq(t.workouts.id, t.planWorkouts.workoutId))
      .where(and(eq(t.planWorkouts.planId, row.id), eq(t.planWorkouts.weekIndex, currentWeek), notDeleted(t.planWorkouts)))
      .all();
    const pace = paceLookup();
    let planned = 0;
    let done = 0;
    for (const r of rows) {
      const items = (JSON.parse(r.itemsJson) as { items: WorkoutItem[] }).items;
      const v = info.measure === 'z2_minutes' ? z2Minutes(items) : totalMeters(items, pace);
      planned += v;
      if (r.status === 'done') done += v;
    }
    return {
      id: row.id,
      presetId: row.presetId as PlanPresetId,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      weeks,
      currentWeek,
      measure:
        info.measure === 'z2_minutes'
          ? { kind: 'z2_minutes', planned: Math.round(planned), done: Math.round(done) }
          : { kind: 'distance', plannedM: Math.round(planned), doneM: Math.round(done) },
      inputs,
    };
  }

  function internalSetting<T>(key: string): T | undefined {
    const row = db.select().from(t.settings).where(and(eq(t.settings.key, key), notDeleted(t.settings))).get();
    return row ? (JSON.parse(row.valueJson) as T) : undefined;
  }

  function setInternalSetting(key: string, value: unknown) {
    const valueJson = JSON.stringify(value);
    db.insert(t.settings)
      .values({ key, valueJson, ...stamp() })
      .onConflictDoUpdate({ target: t.settings.key, set: { valueJson, deletedAt: null, ...stamp() } })
      .run();
  }

  function abandonActive() {
    const active = db.select().from(t.plans).where(and(eq(t.plans.status, 'active'), notDeleted(t.plans))).all();
    for (const p of active) {
      db.update(t.plans).set({ status: 'abandoned', ...stamp() }).where(eq(t.plans.id, p.id)).run();
      // Pending workouts disappear; completed ones stay in history.
      db.update(t.planWorkouts)
        .set({ deletedAt: now(), ...stamp() })
        .where(and(eq(t.planWorkouts.planId, p.id), inArray(t.planWorkouts.status, ['scheduled', 'moved', 'missed'])))
        .run();
    }
  }

  // -------------------------------------------------------------------------
  // Repository

  /** Live HR with Health Connect filling its gaps, as the summary shows it. */
  const sessionHr = (id: string, endMs: number): HrSample[] => {
    const samples = db.select().from(t.hrSamples).where(eq(t.hrSamples.sessionId, id)).orderBy(asc(t.hrSamples.tOffsetMs)).all().map(toHrSample);
    return mergeHr(
      samples.filter((h) => h.source === 'ble'),
      samples.filter((h) => h.source === 'health_connect'),
      endMs,
    );
  };

  /** The zones a session was recorded with, else the current ones. */
  const zonesFor = (hrProfileId: string | null): HrZoneBand[] | undefined => {
    const row = hrProfileId ? db.select({ zonesJson: t.hrProfiles.zonesJson }).from(t.hrProfiles).where(eq(t.hrProfiles.id, hrProfileId)).get() : undefined;
    return row ? (JSON.parse(row.zonesJson) as HrZoneBand[]) : currentZones();
  };

  type StatsSource = Pick<typeof t.sessions.$inferSelect, 'id' | 'mode' | 'startedAt' | 'hrProfileId'>;

  /** SessionStats for a run, from its step log, (outdoor) track and HR. */
  const statsFor = (row: StatsSource, player: PlayerState, distanceM: number, endedAt: number): SessionStats => {
    const points =
      row.mode === 'outdoor' ? db.select().from(t.trackPoints).where(eq(t.trackPoints.sessionId, row.id)).orderBy(asc(t.trackPoints.tOffsetMs)).all().map(toTrackPoint) : [];
    const endMs = endedAt - row.startedAt;
    const zones = zonesFor(row.hrProfileId);
    return sessionStats({
      steps: stepResults(player.steps, player.log),
      distanceM,
      samples: cumulativeDistance(points),
      pauses: player.pauses ?? [],
      log: player.log,
      ...(player.runWalk ? { runWalk: player.runWalk.segments } : {}),
      hr: sessionHr(row.id, endMs),
      ...(zones ? { zones } : {}),
      endMs,
    });
  };

  /**
   * Runs without current stats get them on first use: saved before stats_json existed,
   * saved under an older SESSION_STATS_VERSION, or cleared when Health Connect HR changed.
   */
  const backfillStats = () => {
    const rows = db
      .select({
        id: t.sessions.id,
        mode: t.sessions.mode,
        startedAt: t.sessions.startedAt,
        endedAt: t.sessions.endedAt,
        hrProfileId: t.sessions.hrProfileId,
        playerJson: t.sessions.playerJson,
        distanceM: t.sessions.distanceM,
      })
      .from(t.sessions)
      .where(
        and(
          eq(t.sessions.status, 'saved'),
          eq(t.sessions.kind, 'run'),
          or(isNull(t.sessions.statsJson), sql`${t.sessions.statsJson} NOT LIKE ${`%"v":${SESSION_STATS_VERSION},%`}`),
          notDeleted(t.sessions),
        ),
      )
      .all();
    if (rows.length === 0) return;
    const computed = rows.map((r) => ({ id: r.id, json: JSON.stringify(statsFor(r, JSON.parse(r.playerJson) as PlayerState, r.distanceM, r.endedAt ?? r.startedAt)) }));
    db.transaction((tx) => {
      for (const c of computed) tx.update(t.sessions).set({ statsJson: c.json, ...stamp() }).where(eq(t.sessions.id, c.id)).run();
    });
  };

  const repo: FitRepository = {
    agenda(start, end): AgendaItem[] {
      const pwRows = db
        .select({ pw: t.planWorkouts, w: t.workouts })
        .from(t.planWorkouts)
        .innerJoin(t.workouts, eq(t.workouts.id, t.planWorkouts.workoutId))
        .where(and(gte(t.planWorkouts.date, start), lte(t.planWorkouts.date, end), notDeleted(t.planWorkouts)))
        .all();
      const planWorkouts: PlanWorkoutRow[] = pwRows.map(({ pw, w }) => {
        const row: PlanWorkoutRow = {
          id: pw.id,
          planId: pw.planId,
          workout: {
            id: w.id,
            name: w.name,
            kind: w.kind,
            defaultMode: w.defaultMode,
            items: (JSON.parse(w.itemsJson) as { items: WorkoutItem[] }).items,
          },
          date: pw.date,
          originalDate: pw.originalDate,
          weekIndex: pw.weekIndex,
          role: pw.role as PlanRole,
          status: pw.status,
        };
        if (pw.completedAt) row.completedAt = new Date(pw.completedAt).toISOString();
        const details: CompletionDetails = {};
        if (pw.manualMinutes !== null) details.minutes = pw.manualMinutes;
        if (pw.manualDistanceM !== null) details.distanceM = pw.manualDistanceM;
        if (pw.manualRpe !== null) details.rpe = pw.manualRpe;
        if (pw.manualNote !== null) details.note = pw.manualNote;
        if (Object.keys(details).length > 0) row.details = details;
        if (pw.skipReason) row.skipReason = pw.skipReason;
        if (pw.sessionId) row.sessionId = pw.sessionId;
        if (pw.externalSessionId) row.externalSessionId = pw.externalSessionId;
        return row;
      });

      const overrides = db
        .select()
        .from(t.scheduleOverrides)
        .where(
          and(
            notDeleted(t.scheduleOverrides),
            or(and(gte(t.scheduleOverrides.originalDate, start), lte(t.scheduleOverrides.originalDate, end)), and(gte(t.scheduleOverrides.newDate, start), lte(t.scheduleOverrides.newDate, end))),
          ),
        )
        .all()
        .map((o) => ({ scheduleId: o.scheduleId, originalDate: o.originalDate, newDate: o.newDate }));

      // Completions are keyed by original date, which can sit outside the range for moved occurrences.
      const completions = db
        .select()
        .from(t.routineCompletions)
        .where(and(gte(t.routineCompletions.date, addDays(start, -31)), lte(t.routineCompletions.date, addDays(end, 31)), notDeleted(t.routineCompletions)))
        .all()
        .filter((c) => c.scheduleId !== null)
        .map((c) => {
          const row: Parameters<typeof buildAgenda>[0]['completions'][number] = { scheduleId: c.scheduleId!, date: c.date, status: c.status };
          if (c.completedAt) row.completedAt = new Date(c.completedAt).toISOString();
          if (c.detailsJson) row.details = JSON.parse(c.detailsJson) as CompletionDetails;
          if (c.skipReason) row.skipReason = c.skipReason;
          if (c.sessionId) row.sessionId = c.sessionId;
          if (c.externalSessionId) row.externalSessionId = c.externalSessionId;
          return row;
        });

      const input: Parameters<typeof buildAgenda>[0] = {
        start,
        end,
        planWorkouts,
        schedule: scheduleRows(),
        overrides,
        completions,
        routines: routineMap(),
      };
      const zones = currentZones();
      if (zones) input.hrZones = zones;
      const pace = paceLookup();
      if (pace) input.pace = pace;
      return buildAgenda(input);
    },

    markDone(key, completedAt, details) {
      const at = Date.parse(completedAt);
      if (parseOccurrenceKey(key)) {
        const extra: { completedAt: number; details?: CompletionDetails } = { completedAt: at };
        if (details) extra.details = details;
        upsertCompletion(key, 'done', extra);
        return;
      }
      db.update(t.planWorkouts)
        .set({ status: 'done', completedAt: at, skipReason: null, ...completionDetails(details), ...stamp() })
        .where(eq(t.planWorkouts.id, key))
        .run();
    },

    skip(key, reason) {
      if (parseOccurrenceKey(key)) {
        upsertCompletion(key, 'skipped', reason ? { skipReason: reason } : {});
        return;
      }
      db.update(t.planWorkouts)
        .set({ status: 'skipped', completedAt: null, skipReason: reason ?? null, ...completionDetails(undefined), ...stamp() })
        .where(eq(t.planWorkouts.id, key))
        .run();
    },

    reopen(key) {
      const occ = parseOccurrenceKey(key);
      if (occ) {
        db.update(t.routineCompletions)
          .set({ deletedAt: now(), ...stamp() })
          .where(and(eq(t.routineCompletions.scheduleId, occ.scheduleId), eq(t.routineCompletions.date, occ.originalDate)))
          .run();
        return;
      }
      db.update(t.planWorkouts)
        .set({ status: 'scheduled', completedAt: null, skipReason: null, ...completionDetails(undefined), ...stamp() })
        .where(eq(t.planWorkouts.id, key))
        .run();
    },

    move(key, toDate, scope) {
      const occ = parseOccurrenceKey(key);
      if (!occ || scope === 'once') {
        moveKey(key, toDate);
        return;
      }
      // "Change the schedule": end the old entry, start a new one on the new weekday.
      const row = scheduleRows().find((r) => r.id === occ.scheduleId);
      if (!row) throw new Error(`Unknown schedule entry ${occ.scheduleId}`);
      const { ended, started } = rescheduleEntry(row, occ.originalDate, toDate);
      const newEntryId = newId();
      db.transaction((tx) => {
        tx.update(t.weeklySchedule).set({ endsOn: ended.endsOn ?? null, ...stamp() }).where(eq(t.weeklySchedule.id, row.id)).run();
        tx.insert(t.weeklySchedule)
          .values({
            id: newEntryId,
            weekday: started.weekday,
            routineId: started.routineId,
            slot: started.slot ?? null,
            time: started.time ?? null,
            reminder: row.reminder,
            position: row.position,
            startsOn: started.startsOn ?? null,
            endsOn: started.endsOn ?? null,
            ...created(),
          })
          .run();
        // Drop this occurrence's override; carry a completion over to the new occurrence.
        tx.update(t.scheduleOverrides)
          .set({ deletedAt: now(), ...stamp() })
          .where(and(eq(t.scheduleOverrides.scheduleId, row.id), eq(t.scheduleOverrides.originalDate, occ.originalDate)))
          .run();
        tx.update(t.routineCompletions)
          .set({ scheduleId: newEntryId, date: toDate, ...stamp() })
          .where(and(eq(t.routineCompletions.scheduleId, row.id), eq(t.routineCompletions.date, occ.originalDate)))
          .run();
      });
    },

    swap(keyA, keyB) {
      const dateA = dateOfKey(keyA);
      const dateB = dateOfKey(keyB);
      db.transaction(() => {
        moveKey(keyA, dateB);
        moveKey(keyB, dateA);
      });
    },

    addQuickLog(log) {
      const id = newId();
      db.insert(t.quickLogs)
        .values({ id, date: log.date, activityType: log.activityType, minutes: log.minutes, distanceM: log.distanceM ?? null, note: log.note ?? null, ...created() })
        .run();
      return { id, ...log };
    },

    quickLogs(start, end): QuickLog[] {
      return db
        .select()
        .from(t.quickLogs)
        .where(and(gte(t.quickLogs.date, start), lte(t.quickLogs.date, end), notDeleted(t.quickLogs)))
        .orderBy(asc(t.quickLogs.date))
        .all()
        .map((r) => {
          const log: QuickLog = { id: r.id, date: r.date, activityType: r.activityType as QuickLogType, minutes: r.minutes };
          if (r.distanceM !== null) log.distanceM = r.distanceM;
          if (r.note !== null) log.note = r.note;
          return log;
        });
    },

    currentHrProfile(): HrProfile | undefined {
      const row = db.select().from(t.hrProfiles).where(and(eq(t.hrProfiles.isCurrent, true), notDeleted(t.hrProfiles))).get();
      if (!row) return undefined;
      return {
        ...(JSON.parse(row.inputJson) as HrProfileInput),
        id: row.id,
        zones: JSON.parse(row.zonesJson) as HrZoneBand[],
        createdAt: new Date(row.createdAt).toISOString(),
      };
    },

    saveHrProfile(input) {
      const zones = computeZones(input);
      const id = newId();
      const meta = created();
      db.transaction((tx) => {
        tx.update(t.hrProfiles).set({ isCurrent: false, ...stamp() }).where(eq(t.hrProfiles.isCurrent, true)).run();
        tx.insert(t.hrProfiles)
          .values({
            id,
            method: input.method,
            maxHr: input.maxHr ?? null,
            maxHrSource: input.maxHrSource ?? (input.maxHr !== undefined ? 'measured' : 'estimated'),
            restingHr: input.restingHr ?? null,
            lthr: input.lthr ?? null,
            age: input.age ?? null,
            inputJson: JSON.stringify(input),
            zonesJson: JSON.stringify(zones),
            isCurrent: true,
            ...meta,
          })
          .run();
      });
      return { ...input, id, zones, createdAt: new Date(meta.createdAt).toISOString() };
    },

    activePlan(onDate) {
      const row = db.select().from(t.plans).where(and(eq(t.plans.status, 'active'), notDeleted(t.plans))).get();
      return row ? planSummary(row, onDate) : undefined;
    },

    createPlan(inputs, onDate) {
      const plan = generatePlan(inputs, onDate, newId);
      const recentRace = inputs.fitness?.recentRace;
      const planId = newId();
      db.transaction((tx) => {
        abandonActive();
        tx.insert(t.plans)
          .values({ id: planId, presetId: plan.presetId, name: plan.name, inputsJson: JSON.stringify(inputs), startDate: plan.startDate, endDate: plan.endDate, status: 'active', ...created() })
          .run();
        for (const gw of plan.workouts) {
          tx.insert(t.workouts)
            .values({
              id: gw.workout.id,
              name: gw.workout.name,
              kind: gw.workout.kind,
              defaultMode: gw.workout.defaultMode,
              itemsJson: JSON.stringify({ schemaVersion: WORKOUT_ITEMS_SCHEMA_VERSION, items: gw.workout.items }),
              isTemplate: false,
              ...created(),
            })
            .run();
          tx.insert(t.planWorkouts)
            .values({ id: newId(), planId, workoutId: gw.workout.id, date: gw.date, originalDate: gw.date, weekIndex: gw.weekIndex, role: gw.role, status: 'scheduled', ...created() })
            .run();
        }
        if (plan.vdot !== undefined) {
          tx.update(t.paceProfiles).set({ isCurrent: false, ...stamp() }).where(eq(t.paceProfiles.isCurrent, true)).run();
          tx.insert(t.paceProfiles)
            .values({
              id: newId(),
              vdot: plan.vdot,
              // Paces come from a recent race when given, else the 5K goal (see generatePlan).
              source: recentRace ? 'race' : 'goal',
              sourceDetailJson: JSON.stringify(recentRace ?? { meters: presetInfo(inputs.presetId).raceMeters, seconds: inputs.goalSeconds }),
              isCurrent: true,
              ...created(),
            })
            .run();
        }
      });
      const row = db.select().from(t.plans).where(eq(t.plans.id, planId)).get();
      if (!row) throw new Error('Plan insert failed');
      return planSummary(row, onDate);
    },

    abandonPlan(planId) {
      const row = db.select().from(t.plans).where(eq(t.plans.id, planId)).get();
      if (row?.status === 'active') abandonActive();
    },

    adaptPlan(onDate, opts = {}) {
      const plan = db.select().from(t.plans).where(and(eq(t.plans.status, 'active'), notDeleted(t.plans))).get();
      if (!plan) return { events: [], rebuildPrompt: false };
      const last = db.select().from(t.settings).where(eq(t.settings.key, 'planAdaptedOn')).get();
      if (!opts.force && last && (JSON.parse(last.valueJson) as string) === `${plan.id}@${onDate}`) return { events: [], rebuildPrompt: false };

      const rows = db
        .select({ pw: t.planWorkouts, w: t.workouts, rpe: t.sessions.rpe })
        .from(t.planWorkouts)
        .innerJoin(t.workouts, eq(t.workouts.id, t.planWorkouts.workoutId))
        .leftJoin(t.sessions, eq(t.sessions.id, t.planWorkouts.sessionId))
        .where(and(eq(t.planWorkouts.planId, plan.id), notDeleted(t.planWorkouts)))
        .all();
      const itemsOf = (json: string) => (JSON.parse(json) as { items: WorkoutItem[] }).items;
      const result = adaptPlanRules({
        today: onDate,
        kind: presetInfo(plan.presetId as PlanPresetId).kind,
        endDate: plan.endDate,
        items: rows.map(({ pw, w, rpe }) => {
          const a: AdaptItem = { id: pw.id, date: pw.date, weekIndex: pw.weekIndex, role: pw.role as PlanRole, status: pw.status, hard: isHardWorkout(pw.role, itemsOf(w.itemsJson)), name: w.name };
          const r = pw.manualRpe ?? rpe;
          if (r !== null && r !== undefined) a.rpe = r;
          return a;
        }),
      });

      const events: PlanEvent[] = [];
      db.transaction((tx) => {
        const workoutOf = (id: string) => rows.find((r) => r.pw.id === id)!;
        const setItems = (workoutId: string, items: WorkoutItem[]) =>
          tx.update(t.workouts)
            .set({ itemsJson: JSON.stringify({ schemaVersion: WORKOUT_ITEMS_SCHEMA_VERSION, items }), ...stamp() })
            .where(eq(t.workouts.id, workoutId))
            .run();
        for (const action of result.actions) {
          switch (action.type) {
            case 'missed':
              tx.update(t.planWorkouts).set({ status: 'missed', ...stamp() }).where(eq(t.planWorkouts.id, action.id)).run();
              break;
            case 'move':
              tx.update(t.planWorkouts).set({ date: action.to, ...stamp() }).where(eq(t.planWorkouts.id, action.id)).run();
              break;
            case 'repeat_long':
              setItems(workoutOf(action.toId).w.id, itemsOf(workoutOf(action.fromId).w.itemsJson));
              break;
            case 'scale_week':
              for (const r of rows.filter((x) => x.pw.weekIndex === action.week && x.pw.status === 'scheduled')) setItems(r.w.id, scaleItems(itemsOf(r.w.itemsJson), action.factor));
              break;
            case 'shift_weeks':
              for (const r of rows.filter((x) => x.pw.weekIndex >= action.fromWeek && x.pw.status === 'scheduled')) {
                tx.update(t.planWorkouts)
                  .set({ date: addDays(r.pw.date, 7), originalDate: addDays(r.pw.originalDate, 7), ...stamp() })
                  .where(eq(t.planWorkouts.id, r.pw.id))
                  .run();
              }
              tx.update(t.plans).set({ endDate: addDays(plan.endDate, 7), ...stamp() }).where(eq(t.plans.id, plan.id)).run();
              break;
          }
        }
        // The easy-run hint repeats at most weekly.
        const weekAgo = now() - 7 * 86_400_000;
        const recentEasyHint = db
          .select({ id: t.planEvents.id })
          .from(t.planEvents)
          .where(and(eq(t.planEvents.planId, plan.id), eq(t.planEvents.type, 'easy_too_hard'), gte(t.planEvents.createdAt, weekAgo)))
          .get();
        for (const e of result.events) {
          if (e.type === 'easy_too_hard' && recentEasyHint) continue;
          const id = newId();
          const row = { id, planId: plan.id, planWorkoutId: e.planWorkoutId ?? null, type: e.type, message: e.message, deletedAt: null, ...created() };
          tx.insert(t.planEvents).values(row).run();
          events.push(toPlanEvent(row));
        }
        const valueJson = JSON.stringify(`${plan.id}@${onDate}`);
        tx.insert(t.settings)
          .values({ key: 'planAdaptedOn', valueJson, ...stamp() })
          .onConflictDoUpdate({ target: t.settings.key, set: { valueJson, ...stamp() } })
          .run();
      });
      return { events, rebuildPrompt: result.rebuildPrompt };
    },

    planEvents(limit) {
      const plan = db.select({ id: t.plans.id }).from(t.plans).where(and(eq(t.plans.status, 'active'), notDeleted(t.plans))).get();
      if (!plan) return [];
      return db
        .select()
        .from(t.planEvents)
        .where(and(eq(t.planEvents.planId, plan.id), notDeleted(t.planEvents)))
        .orderBy(desc(t.planEvents.createdAt))
        .limit(limit)
        .all()
        .map(toPlanEvent);
    },

    shiftRestOfWeek(from) {
      const plan = db.select({ id: t.plans.id }).from(t.plans).where(and(eq(t.plans.status, 'active'), notDeleted(t.plans))).get();
      if (!plan) return;
      const rows = db
        .select({ id: t.planWorkouts.id, date: t.planWorkouts.date, status: t.planWorkouts.status })
        .from(t.planWorkouts)
        .where(and(eq(t.planWorkouts.planId, plan.id), notDeleted(t.planWorkouts)))
        .all();
      db.transaction((tx) => {
        for (const m of shiftRestOfWeekRule(rows, from)) {
          tx.update(t.planWorkouts).set({ date: m.to, ...stamp() }).where(eq(t.planWorkouts.id, m.id)).run();
        }
      });
    },

    pushPlanBack(from) {
      const plan = db.select().from(t.plans).where(and(eq(t.plans.status, 'active'), notDeleted(t.plans))).get();
      if (!plan) return;
      db.transaction((tx) => {
        tx.update(t.planWorkouts)
          .set({ date: sql`date(${t.planWorkouts.date}, '+7 days')`, originalDate: sql`date(${t.planWorkouts.originalDate}, '+7 days')`, ...stamp() })
          .where(and(eq(t.planWorkouts.planId, plan.id), eq(t.planWorkouts.status, 'scheduled'), gte(t.planWorkouts.date, from), notDeleted(t.planWorkouts)))
          .run();
        tx.update(t.plans).set({ endDate: addDays(plan.endDate, 7), ...stamp() }).where(eq(t.plans.id, plan.id)).run();
      });
    },

    rebuildPlan(onDate) {
      const plan = db.select().from(t.plans).where(and(eq(t.plans.status, 'active'), notDeleted(t.plans))).get();
      if (!plan) throw new Error('No active plan');
      const inputs = JSON.parse(plan.inputsJson) as PlanInputs;
      // Fitness plans restart today; race plans keep the race date with fewer weeks left.
      const next: PlanInputs = presetInfo(inputs.presetId).kind === 'fitness' ? { ...inputs, startDate: onDate } : inputs;
      return repo.createPlan(next, onDate);
    },

    routines(): Routine[] {
      return [...routineMap()].map(([id, r]) => ({ id, kind: r.kind, name: r.name, itemCount: r.itemCount, estSeconds: r.estSeconds, origin: r.origin }));
    },

    schedule(): ScheduleEntry[] {
      // Current entries only: ended entries exist to keep past weeks intact.
      const d = today();
      return scheduleRows()
        .filter((r) => !r.endsOn || r.endsOn >= d)
        .map(({ id, weekday, routineId, slot, time, reminder, position }) => {
          const e: ScheduleEntry = { id, weekday, routineId, reminder, position };
          if (slot) e.slot = slot;
          if (time) e.time = time;
          return e;
        });
    },

    addScheduleEntry(entry) {
      const id = newId();
      const position = scheduleRows().filter((r) => r.weekday === entry.weekday).length;
      db.insert(t.weeklySchedule)
        .values({ id, weekday: entry.weekday, routineId: entry.routineId, slot: entry.slot ?? null, time: entry.time ?? null, reminder: entry.reminder, position, startsOn: today(), ...created() })
        .run();
      return { ...entry, id, position };
    },

    updateScheduleEntry(id, patch) {
      const row = scheduleRows().find((r) => r.id === id);
      if (!row) throw new Error(`Unknown schedule entry ${id}`);
      if (patch.weekday !== undefined && patch.weekday !== row.weekday) {
        // A weekday change applies from today on; past weeks keep the old day.
        const d = today();
        db.transaction((tx) => {
          tx.update(t.weeklySchedule).set({ endsOn: addDays(d, -1), ...stamp() }).where(eq(t.weeklySchedule.id, id)).run();
          tx.insert(t.weeklySchedule)
            .values({
              id: newId(),
              weekday: patch.weekday!,
              routineId: patch.routineId ?? row.routineId,
              slot: (patch.slot ?? row.slot) ?? null,
              time: (patch.time ?? row.time) ?? null,
              reminder: patch.reminder ?? row.reminder,
              position: patch.position ?? row.position,
              startsOn: d,
              ...created(),
            })
            .run();
        });
        return;
      }
      const set: Partial<typeof t.weeklySchedule.$inferInsert> = { ...stamp() };
      if (patch.routineId !== undefined) set.routineId = patch.routineId;
      if (patch.slot !== undefined) set.slot = patch.slot;
      if (patch.time !== undefined) set.time = patch.time;
      if (patch.reminder !== undefined) set.reminder = patch.reminder;
      if (patch.position !== undefined) set.position = patch.position;
      db.update(t.weeklySchedule).set(set).where(eq(t.weeklySchedule.id, id)).run();
    },

    removeScheduleEntry(id) {
      // Ending (not deleting) keeps past occurrences and their completions.
      db.update(t.weeklySchedule).set({ endsOn: addDays(today(), -1), ...stamp() }).where(eq(t.weeklySchedule.id, id)).run();
    },

    workout(id) {
      const w = db.select().from(t.workouts).where(and(eq(t.workouts.id, id), notDeleted(t.workouts))).get();
      if (!w) return undefined;
      const workout: Workout = { id: w.id, name: w.name, kind: w.kind, defaultMode: w.defaultMode, items: (JSON.parse(w.itemsJson) as { items: WorkoutItem[] }).items };
      if (w.notes) workout.notes = w.notes;
      return workout;
    },

    workoutLibrary() {
      const pace = paceLookup();
      return db
        .select()
        .from(t.workouts)
        .where(and(eq(t.workouts.isTemplate, true), notDeleted(t.workouts)))
        .orderBy(desc(t.workouts.updatedAt))
        .all()
        .map((w) => {
          const items = (JSON.parse(w.itemsJson) as { items: WorkoutItem[] }).items;
          return {
            id: w.id,
            name: w.name,
            defaultMode: w.defaultMode,
            estSeconds: totalSeconds(items, pace),
            estMeters: totalMeters(items, pace),
            structure: structureSegments(items, pace),
            updatedAt: new Date(w.updatedAt).toISOString(),
          };
        });
    },

    saveWorkout(input, id) {
      const values = {
        name: input.name.trim(),
        kind: 'run' as const,
        defaultMode: input.defaultMode,
        itemsJson: JSON.stringify({ schemaVersion: WORKOUT_ITEMS_SCHEMA_VERSION, items: input.items }),
        notes: input.notes?.trim() || null,
        isTemplate: input.template,
      };
      if (id) {
        db.update(t.workouts)
          .set({ ...values, ...stamp() })
          .where(eq(t.workouts.id, id))
          .run();
        return id;
      }
      const newWorkoutId = newId();
      db.insert(t.workouts)
        .values({ id: newWorkoutId, ...values, ...created() })
        .run();
      return newWorkoutId;
    },

    duplicateWorkout(id, name) {
      const w = repo.workout(id);
      if (!w) throw new Error(`Unknown workout ${id}`);
      const input: WorkoutInput = { name, items: w.items, defaultMode: w.defaultMode, template: true };
      if (w.notes) input.notes = w.notes;
      return repo.saveWorkout(input);
    },

    deleteWorkout(id) {
      db.update(t.workouts)
        .set({ deletedAt: now(), ...stamp() })
        .where(and(eq(t.workouts.id, id), eq(t.workouts.isTemplate, true)))
        .run();
    },

    currentVdot() {
      return db.select({ vdot: t.paceProfiles.vdot }).from(t.paceProfiles).where(and(eq(t.paceProfiles.isCurrent, true), notDeleted(t.paceProfiles))).get()?.vdot;
    },

    paceProfile() {
      const row = db.select().from(t.paceProfiles).where(and(eq(t.paceProfiles.isCurrent, true), notDeleted(t.paceProfiles))).get();
      return row ? toPaceProfile(row) : undefined;
    },

    paceHistory() {
      return db.select().from(t.paceProfiles).where(notDeleted(t.paceProfiles)).orderBy(desc(t.paceProfiles.createdAt)).all().map(toPaceProfile);
    },

    setPaceProfile(input) {
      const id = newId();
      const detail = input.detail ? { ...input.detail, ...(input.sessionId ? { sessionId: input.sessionId } : {}) } : undefined;
      db.transaction((tx) => {
        tx.update(t.paceProfiles)
          .set({ isCurrent: false, ...stamp() })
          .where(eq(t.paceProfiles.isCurrent, true))
          .run();
        tx.insert(t.paceProfiles)
          .values({ id, vdot: Math.round(input.vdot * 10) / 10, source: input.source, sourceDetailJson: detail ? JSON.stringify(detail) : null, isCurrent: true, ...created() })
          .run();
      });
      return repo.paceProfile()!;
    },

    sessionTrial(sessionId) {
      if (internalSetting<string[]>('dismissedTrials')?.includes(sessionId)) return undefined;
      const s = repo.session(sessionId);
      return s?.endedAt ? trialResult(s.steps) : undefined;
    },

    dismissTrial(sessionId) {
      setInternalSetting('dismissedTrials', [...(internalSetting<string[]>('dismissedTrials') ?? []), sessionId].slice(-50));
    },

    paceBump() {
      const profile = repo.paceProfile();
      if (!profile) return undefined;
      const dismissed = db.select().from(t.settings).where(and(eq(t.settings.key, 'paceBumpDismissedAt'), notDeleted(t.settings))).get();
      const since = Math.max(Date.parse(profile.createdAt), dismissed ? (JSON.parse(dismissed.valueJson) as number) : 0);
      const rows = db
        .select({ playerJson: t.sessions.playerJson })
        .from(t.sessions)
        .where(and(eq(t.sessions.status, 'saved'), notDeleted(t.sessions), gte(t.sessions.startedAt, since)))
        .orderBy(desc(t.sessions.startedAt))
        .limit(20)
        .all();
      const sessions = rows.map((r) => {
        const p = JSON.parse(r.playerJson) as PlayerState;
        return stepResults(p.steps, p.log);
      });
      const to = vdotBumpSuggestion(sessions, profile.vdot);
      return to === undefined ? undefined : { from: profile.vdot, to };
    },

    dismissPaceBump() {
      // Internal key like catalogVersion, so it stays out of Settings.
      const valueJson = JSON.stringify(now());
      db.insert(t.settings)
        .values({ key: 'paceBumpDismissedAt', valueJson, ...stamp() })
        .onConflictDoUpdate({ target: t.settings.key, set: { valueJson, deletedAt: null, ...stamp() } })
        .run();
    },

    startSession(input) {
      const id = newId();
      const current = (table: typeof t.paceProfiles | typeof t.hrProfiles) =>
        db.select({ id: table.id }).from(table).where(and(eq(table.isCurrent, true), notDeleted(table))).get()?.id ?? null;
      db.insert(t.sessions)
        .values({
          id,
          workoutId: input.workoutId ?? null,
          planWorkoutId: input.planWorkoutId ?? null,
          name: input.name,
          mode: input.mode,
          status: 'active',
          startedAt: Date.parse(input.startedAt),
          paceProfileId: current(t.paceProfiles),
          hrProfileId: current(t.hrProfiles),
          playerJson: JSON.stringify(input.player),
          ...created(),
        })
        .run();
      return id;
    },

    saveProgress(id, progress) {
      db.transaction((tx) => {
        tx.update(t.sessions)
          .set({ playerJson: JSON.stringify(progress.player), distanceM: progress.distanceM, ...stamp() })
          .where(and(eq(t.sessions.id, id), eq(t.sessions.status, 'active')))
          .run();
        // One multi-row insert each: building a statement per row is the cost on Hermes.
        for (let i = 0; i < progress.points.length; i += HR_BATCH) {
          tx.insert(t.trackPoints)
            .values(progress.points.slice(i, i + HR_BATCH).map((p) => ({ sessionId: id, tOffsetMs: p.tOffsetMs, lat: p.lat, lng: p.lng, alt: p.alt ?? null, accuracy: p.accuracy, speed: p.speed ?? null })))
            .onConflictDoNothing()
            .run();
        }
        const hr = progress.hr ?? [];
        for (let i = 0; i < hr.length; i += HR_BATCH) {
          tx.insert(t.hrSamples)
            .values(hr.slice(i, i + HR_BATCH).map((h) => ({ sessionId: id, tOffsetMs: h.tOffsetMs, bpm: h.bpm, source: 'ble' as const })))
            .onConflictDoNothing()
            .run();
        }
      });
    },

    finishSession(id, finish) {
      const row = db.select().from(t.sessions).where(eq(t.sessions.id, id)).get();
      if (!row) throw new Error(`Unknown session ${id}`);
      const results = stepResults(finish.player.steps, finish.player.log);
      const activeS = finish.elapsedMs / 1000;
      const avgPace = finish.distanceM >= 50 ? activeS / (finish.distanceM / 1000) : null;
      const endedAt = Date.parse(finish.endedAt);
      // A live trace with no gaps never needs Health Connect HR, so sessionsNeedingHr can skip
      // it by its column instead of re-reading every sample on each sync.
      const live = db
        .select({ tOffsetMs: t.hrSamples.tOffsetMs, bpm: t.hrSamples.bpm })
        .from(t.hrSamples)
        .where(and(eq(t.hrSamples.sessionId, id), eq(t.hrSamples.source, 'ble')))
        .orderBy(asc(t.hrSamples.tOffsetMs))
        .all()
        .map((h) => ({ ...h, source: 'ble' as const }));
      const liveComplete = live.length > 0 && hrGaps(live, endedAt - row.startedAt).length === 0;
      const stats = statsFor(row, finish.player, finish.distanceM, endedAt);
      db.transaction((tx) => {
        tx.update(t.sessions)
          .set({
            status: 'saved',
            endedAt,
            statsJson: JSON.stringify(stats),
            ...(liveComplete ? { hrFilledAt: -1 } : {}),
            elapsedMs: finish.elapsedMs,
            pausedMs: finish.pausedMs,
            distanceM: finish.distanceM,
            avgPaceSPerKm: avgPace,
            rpe: finish.rpe ?? null,
            notes: finish.notes ?? null,
            playerJson: JSON.stringify(finish.player),
            ...stamp(),
          })
          .where(eq(t.sessions.id, id))
          .run();
        finish.player.log.forEach((entry, i) => {
          const r = results[i]!;
          tx.insert(t.sessionSteps)
            .values({
              id: newId(),
              sessionId: id,
              idx: entry.idx,
              stepJson: JSON.stringify(r.step),
              startedAtOffsetMs: entry.startOffsetMs,
              endedAtOffsetMs: entry.endOffsetMs,
              activeMs: entry.endActiveMs - entry.startActiveMs,
              distanceM: r.distanceM,
              avgPaceSPerKm: r.avgPaceSecPerKm ?? null,
              skipped: entry.skipped,
              ...created(),
            })
            .run();
        });
        // A recorded run completes its plan workout (Done + data), upgrading a manual Done too.
        if (row.planWorkoutId) {
          tx.update(t.planWorkouts)
            .set({ status: 'done', completedAt: endedAt, sessionId: id, skipReason: null, ...stamp() })
            .where(eq(t.planWorkouts.id, row.planWorkoutId))
            .run();
        }
      });
    },

    discardSession(id) {
      db.transaction((tx) => {
        tx.update(t.sessions).set({ status: 'discarded', deletedAt: now(), ...stamp() }).where(eq(t.sessions.id, id)).run();
        tx.delete(t.trackPoints).where(eq(t.trackPoints.sessionId, id)).run();
        tx.delete(t.hrSamples).where(eq(t.hrSamples.sessionId, id)).run();
      });
    },

    activeSession(): ActiveSession | undefined {
      const row = db.select().from(t.sessions).where(and(eq(t.sessions.status, 'active'), notDeleted(t.sessions))).orderBy(desc(t.sessions.startedAt)).get();
      if (!row) return undefined;
      const s: ActiveSession = {
        id: row.id,
        name: row.name,
        mode: row.mode,
        startedAt: new Date(row.startedAt).toISOString(),
        player: JSON.parse(row.playerJson) as PlayerState,
        distanceM: row.distanceM,
      };
      if (row.workoutId) s.workoutId = row.workoutId;
      if (row.planWorkoutId) s.planWorkoutId = row.planWorkoutId;
      const last = db.select().from(t.trackPoints).where(eq(t.trackPoints.sessionId, row.id)).orderBy(desc(t.trackPoints.tOffsetMs)).limit(1).get();
      if (last) s.lastPoint = toTrackPoint(last);
      return s;
    },

    session(id): SessionDetail | undefined {
      const row = db.select().from(t.sessions).where(and(eq(t.sessions.id, id), notDeleted(t.sessions))).get();
      if (!row) return undefined;
      const player = JSON.parse(row.playerJson) as PlayerState;
      const points = db.select().from(t.trackPoints).where(eq(t.trackPoints.sessionId, id)).orderBy(asc(t.trackPoints.tOffsetMs)).all().map(toTrackPoint);
      const detail: SessionDetail = {
        id: row.id,
        name: row.name,
        mode: row.mode,
        startedAt: new Date(row.startedAt).toISOString(),
        distanceM: row.distanceM,
        elapsedMs: row.elapsedMs,
        pausedMs: row.pausedMs,
        steps: stepResults(player.steps, player.log),
        log: player.log,
        pauses: player.pauses ?? [],
        points,
        hr: [],
        hrFromHealth: false,
      };
      const samples = db.select().from(t.hrSamples).where(eq(t.hrSamples.sessionId, id)).orderBy(asc(t.hrSamples.tOffsetMs)).all().map(toHrSample);
      const health = samples.filter((h) => h.source === 'health_connect');
      detail.hr = mergeHr(
        samples.filter((h) => h.source === 'ble'),
        health,
        (row.endedAt ?? now()) - row.startedAt,
      );
      detail.hrFromHealth = health.length > 0;
      if (row.endedAt) detail.endedAt = new Date(row.endedAt).toISOString();
      if (row.avgPaceSPerKm !== null) detail.avgPaceSecPerKm = row.avgPaceSPerKm;
      if (row.rpe !== null) detail.rpe = row.rpe;
      if (row.notes !== null) detail.notes = row.notes;
      if (row.workoutId) detail.workoutId = row.workoutId;
      if (row.planWorkoutId) detail.planWorkoutId = row.planWorkoutId;
      return detail;
    },

    recentSessions(limit): SessionListItem[] {
      return db
        .select()
        .from(t.sessions)
        .where(and(eq(t.sessions.status, 'saved'), notDeleted(t.sessions)))
        .orderBy(desc(t.sessions.startedAt))
        .limit(limit)
        .all()
        .map((r) => ({ id: r.id, name: r.name, mode: r.mode, startedAt: new Date(r.startedAt).toISOString(), distanceM: r.distanceM, elapsedMs: r.elapsedMs }));
    },

    updateSessionNotes(id, patch) {
      const set: Partial<typeof t.sessions.$inferInsert> = { ...stamp() };
      if (patch.rpe !== undefined) set.rpe = patch.rpe;
      if (patch.notes !== undefined) set.notes = patch.notes;
      db.update(t.sessions).set(set).where(eq(t.sessions.id, id)).run();
    },

    correctDistance(id, totalM) {
      const row = db.select().from(t.sessions).where(eq(t.sessions.id, id)).get();
      if (!row) throw new Error(`Unknown session ${id}`);
      const player = JSON.parse(row.playerJson) as PlayerState;
      const log = rescaleLog(player.log, totalM);
      const steps = db.select().from(t.sessionSteps).where(eq(t.sessionSteps.sessionId, id)).all();
      db.transaction((tx) => {
        tx.update(t.sessions)
          .set({
            distanceM: totalM,
            avgPaceSPerKm: totalM >= 50 ? row.elapsedMs / 1000 / (totalM / 1000) : null,
            playerJson: JSON.stringify({ ...player, log }),
            statsJson: JSON.stringify(statsFor(row, { ...player, log }, totalM, row.endedAt ?? row.startedAt)),
            ...stamp(),
          })
          .where(eq(t.sessions.id, id))
          .run();
        for (const s of steps) {
          const e = log.find((l) => l.idx === s.idx && l.startOffsetMs === s.startedAtOffsetMs);
          if (!e) continue;
          const distanceM = e.endDistanceM - e.startDistanceM;
          tx.update(t.sessionSteps)
            .set({ distanceM, avgPaceSPerKm: distanceM >= 10 ? s.activeMs / 1000 / (distanceM / 1000) : null, ...stamp() })
            .where(eq(t.sessionSteps.id, s.id))
            .run();
        }
      });
    },

    renameSession(id, name) {
      db.update(t.sessions)
        .set({ name, ...stamp() })
        .where(eq(t.sessions.id, id))
        .run();
    },

    attachExternalRoute(externalId, points) {
      db.transaction((tx) => {
        tx.delete(t.trackPoints).where(eq(t.trackPoints.sessionId, externalId)).run();
        for (let i = 0; i < points.length; i += HR_BATCH) {
          tx.insert(t.trackPoints)
            .values(
              points.slice(i, i + HR_BATCH).map((p) => ({ sessionId: externalId, tOffsetMs: p.tOffsetMs, lat: p.lat, lng: p.lng, alt: p.alt ?? null, accuracy: p.accuracy, speed: p.speed ?? null, source: 'file' as const })),
            )
            .onConflictDoNothing()
            .run();
        }
        tx.update(t.externalSessions)
          .set({ hasRoute: points.length > 0, ...stamp() })
          .where(eq(t.externalSessions.id, externalId))
          .run();
      });
    },

    externalRoute(externalId) {
      return db.select().from(t.trackPoints).where(eq(t.trackPoints.sessionId, externalId)).orderBy(asc(t.trackPoints.tOffsetMs)).all().map(toTrackPoint);
    },

    catalogVersion() {
      const row = db.select().from(t.settings).where(eq(t.settings.key, 'catalogVersion')).get();
      return row ? (JSON.parse(row.valueJson) as string) : undefined;
    },

    seedCatalog(catalog) {
      db.transaction((tx) => {
        // Multi-row upserts: one statement per row cost about a minute on Hermes for 876 rows.
        const rows = catalog.exercises.map((e) => ({
          id: e.id,
          slug: e.slug,
          name: e.name,
          kind: e.kind,
          musclePrimary: e.musclePrimary,
          musclesSecondaryJson: JSON.stringify(e.musclesSecondary),
          equipment: e.equipment,
          tracking: e.tracking,
          level: e.level,
          instructionsJson: JSON.stringify(e.instructions),
          imageKeysJson: JSON.stringify(e.imageKeys),
          sides: e.sides,
          defaultHoldS: e.defaultHoldS ?? null,
          aliasesJson: JSON.stringify(e.aliases),
          searchText: searchText(e.name, e.aliases),
          sourceRef: e.sourceRef,
          dataVersion: catalog.version,
          origin: 'seed' as const,
          ...created(),
        }));
        // Hidden flags are yours; an update never touches them.
        const columns = getTableColumns(t.exercises);
        const set = Object.fromEntries(
          (['slug', 'name', 'kind', 'musclePrimary', 'musclesSecondaryJson', 'equipment', 'tracking', 'level', 'instructionsJson', 'imageKeysJson', 'sides', 'defaultHoldS', 'aliasesJson', 'searchText', 'sourceRef', 'dataVersion', 'deletedAt', 'updatedAt', 'dirty'] as const).map(
            (k) => [k, sql.raw(`excluded.${columns[k].name}`)],
          ),
        );
        for (let i = 0; i < rows.length; i += SEED_BATCH) {
          tx.insert(t.exercises)
            .values(rows.slice(i, i + SEED_BATCH))
            .onConflictDoUpdate({ target: t.exercises.id, set })
            .run();
        }
        // Seed rows no longer in the catalog are hidden, not deleted, so history still resolves.
        tx.update(t.exercises)
          .set({ hidden: true, ...stamp() })
          .where(and(eq(t.exercises.origin, 'seed'), or(isNull(t.exercises.dataVersion), ne(t.exercises.dataVersion, catalog.version))))
          .run();

        const starters = tx.select().from(t.routines).where(eq(t.routines.origin, 'starter')).all();
        for (const r of catalog.routines) {
          const items: RoutineItems = { ...r, schemaVersion: 2 } as RoutineItems;
          const { slug: _slug, name: _name, ...body } = items as RoutineItems & { slug: string; name: string };
          const itemsJson = JSON.stringify(body);
          const existing = starters.find((s) => s.starterSlug === r.slug) ?? starters.find((s) => !s.starterSlug && LEGACY_STARTERS[s.name] === r.slug);
          if (existing) {
            tx.update(t.routines)
              .set({ name: r.name, kind: r.kind, itemsJson, starterSlug: r.slug, deletedAt: null, ...stamp() })
              .where(eq(t.routines.id, existing.id))
              .run();
          } else {
            tx.insert(t.routines).values({ id: newId(), kind: r.kind, name: r.name, itemsJson, origin: 'starter', starterSlug: r.slug, ...created() }).run();
          }
        }

        const valueJson = JSON.stringify(catalog.version);
        tx.insert(t.settings)
          .values({ key: 'catalogVersion', valueJson, ...stamp() })
          .onConflictDoUpdate({ target: t.settings.key, set: { valueJson, ...stamp() } })
          .run();
      });
    },

    exercises(filter = {}) {
      const conds = [notDeleted(t.exercises)];
      if (!filter.includeHidden) conds.push(eq(t.exercises.hidden, false));
      if (filter.kind) conds.push(eq(t.exercises.kind, filter.kind));
      if (filter.muscle) conds.push(eq(t.exercises.musclePrimary, filter.muscle));
      if (filter.equipment) conds.push(eq(t.exercises.equipment, filter.equipment));
      const q = filter.query?.trim().toLowerCase();
      if (q) conds.push(like(t.exercises.searchText, `% ${q.replace(/[^a-z0-9]+/g, ' ').trim()}%`));
      return db.select().from(t.exercises).where(and(...conds)).orderBy(asc(t.exercises.name)).all().map(toSummary);
    },

    exerciseCounts() {
      const row = db
        .select({ total: sql<number>`count(*)`, custom: sql<number>`coalesce(sum(${t.exercises.origin} = 'custom'), 0)` })
        .from(t.exercises)
        .where(and(notDeleted(t.exercises), eq(t.exercises.hidden, false)))
        .get();
      return { total: row?.total ?? 0, custom: row?.custom ?? 0 };
    },

    exercise(id) {
      const row = db.select().from(t.exercises).where(and(eq(t.exercises.id, id), notDeleted(t.exercises))).get();
      return row ? toExercise(row) : undefined;
    },

    addCustomExercise(input) {
      const id = newId();
      db.insert(t.exercises)
        .values({
          id,
          slug: `custom-${id.toLowerCase()}`,
          name: input.name,
          kind: input.kind,
          musclePrimary: input.musclePrimary,
          musclesSecondaryJson: '[]',
          equipment: input.equipment,
          tracking: input.tracking,
          level: 'beginner',
          instructionsJson: '[]',
          imageKeysJson: '[]',
          sides: input.sides ?? 'none',
          defaultHoldS: input.defaultHoldS ?? null,
          aliasesJson: '[]',
          searchText: searchText(input.name, []),
          origin: 'custom',
          note: input.note ?? null,
          ...created(),
        })
        .run();
      return toSummary(db.select().from(t.exercises).where(eq(t.exercises.id, id)).get()!);
    },

    setExerciseHidden(id, hidden) {
      db.update(t.exercises).set({ hidden, ...stamp() }).where(eq(t.exercises.id, id)).run();
    },

    routine(id): RoutineDetail | undefined {
      const r = db.select().from(t.routines).where(and(eq(t.routines.id, id), notDeleted(t.routines))).get();
      if (!r) return undefined;
      const detail: RoutineDetail = { id: r.id, kind: r.kind, name: r.name, origin: r.origin, ...routineStats(r.itemsJson), items: parseRoutineItems(r.itemsJson, r.kind) };
      if (r.notes) detail.notes = r.notes;
      return detail;
    },

    createRoutine(input) {
      const id = newId();
      db.insert(t.routines)
        .values({ id, kind: input.items.kind, name: input.name, itemsJson: JSON.stringify(input.items), notes: input.notes ?? null, origin: 'custom', ...created() })
        .run();
      return id;
    },

    updateRoutine(id, input) {
      const r = db.select({ origin: t.routines.origin }).from(t.routines).where(eq(t.routines.id, id)).get();
      if (!r) throw new Error(`Unknown routine ${id}`);
      if (r.origin === 'starter') throw new Error('Starter routines are read-only. Duplicate it to edit.');
      db.update(t.routines)
        .set({ name: input.name, kind: input.items.kind, itemsJson: JSON.stringify(input.items), notes: input.notes ?? null, ...stamp() })
        .where(eq(t.routines.id, id))
        .run();
    },

    duplicateRoutine(id, name) {
      const r = db.select().from(t.routines).where(eq(t.routines.id, id)).get();
      if (!r) throw new Error(`Unknown routine ${id}`);
      const copy = newId();
      db.insert(t.routines)
        .values({ id: copy, kind: r.kind, name, itemsJson: JSON.stringify(parseRoutineItems(r.itemsJson, r.kind)), notes: r.notes, origin: 'custom', ...created() })
        .run();
      return copy;
    },

    deleteRoutine(id) {
      db.transaction((tx) => {
        tx.update(t.routines).set({ deletedAt: now(), ...stamp() }).where(eq(t.routines.id, id)).run();
        tx.update(t.weeklySchedule)
          .set({ endsOn: addDays(today(), -1), ...stamp() })
          .where(and(eq(t.weeklySchedule.routineId, id), or(isNull(t.weeklySchedule.endsOn), gte(t.weeklySchedule.endsOn, today()))))
          .run();
      });
    },

    lastSets(exerciseIds) {
      if (exerciseIds.length === 0) return {};
      const rows = db
        .select({ s: t.strengthSets })
        .from(t.strengthSets)
        .innerJoin(t.sessions, eq(t.sessions.id, t.strengthSets.sessionId))
        .where(and(inArray(t.strengthSets.exerciseId, [...exerciseIds]), eq(t.sessions.status, 'saved'), notDeleted(t.strengthSets)))
        .orderBy(desc(t.strengthSets.completedAt))
        .limit(exerciseIds.length * 30)
        .all();
      const out: Record<string, LoggedSet[]> = {};
      const sessionOf: Record<string, string> = {};
      for (const { s } of rows) {
        sessionOf[s.exerciseId] ??= s.sessionId;
        if (sessionOf[s.exerciseId] !== s.sessionId) continue;
        const set: LoggedSet = { exerciseId: s.exerciseId, setIdx: s.setIdx, reps: s.reps };
        if (s.weightKg !== null) set.weightKg = s.weightKg;
        if (s.durationS !== null) set.durationS = s.durationS;
        (out[s.exerciseId] ??= []).unshift(set);
      }
      return out;
    },

    saveStrengthSession(input) {
      const id = newId();
      const startedAt = Date.parse(input.startedAt);
      const endedAt = Date.parse(input.endedAt);
      db.transaction((tx) => {
        tx.insert(t.sessions)
          .values({
            id,
            routineId: input.routineId ?? null,
            name: input.name,
            mode: 'timer',
            kind: 'strength',
            status: 'saved',
            startedAt,
            endedAt,
            elapsedMs: endedAt - startedAt,
            rpe: input.rpe ?? null,
            notes: input.notes ?? null,
            playerJson: JSON.stringify(EMPTY_PLAYER),
            summaryJson: JSON.stringify({ volumeKg: volumeKg(input.sets), sets: input.sets.length }),
            ...created(),
          })
          .run();
        for (const set of input.sets) {
          tx.insert(t.strengthSets)
            .values({
              id: newId(),
              sessionId: id,
              exerciseId: set.exerciseId,
              setIdx: set.setIdx,
              reps: set.reps,
              weightKg: set.weightKg ?? null,
              durationS: set.durationS ?? null,
              completedAt: Date.parse(set.completedAt),
              ...created(),
            })
            .run();
        }
      });
      if (input.scheduleKey) upsertCompletion(input.scheduleKey, 'done', { completedAt: endedAt, sessionId: id });
      return id;
    },

    exerciseHistory(exerciseId, limit) {
      const rows = db
        .select({ s: t.strengthSets, startedAt: t.sessions.startedAt })
        .from(t.strengthSets)
        .innerJoin(t.sessions, eq(t.sessions.id, t.strengthSets.sessionId))
        .where(and(eq(t.strengthSets.exerciseId, exerciseId), eq(t.sessions.status, 'saved'), notDeleted(t.strengthSets)))
        .orderBy(desc(t.sessions.startedAt), asc(t.strengthSets.setIdx))
        .all();
      const out: ExerciseHistoryEntry[] = [];
      for (const { s, startedAt } of rows) {
        let entry = out.find((e) => e.sessionId === s.sessionId);
        if (!entry) {
          if (out.length >= limit) break;
          entry = { sessionId: s.sessionId, date: localIsoDate(new Date(startedAt)), sets: [] };
          out.push(entry);
        }
        const set: LoggedSet = { exerciseId, setIdx: s.setIdx, reps: s.reps };
        if (s.weightKg !== null) set.weightKg = s.weightKg;
        entry.sets.push(set);
      }
      return out;
    },

    healthSyncState() {
      const row = db.select().from(t.hcSyncState).where(eq(t.hcSyncState.key, 'health_connect')).get();
      const out: { changesToken?: string; lastSyncedAt?: string } = {};
      if (row?.changesToken) out.changesToken = row.changesToken;
      if (row?.lastSyncedAt) out.lastSyncedAt = new Date(row.lastSyncedAt).toISOString();
      return out;
    },

    setHealthSyncState(state) {
      const values = { changesToken: state.changesToken ?? null, lastSyncedAt: Date.parse(state.lastSyncedAt) };
      db.insert(t.hcSyncState)
        .values({ key: 'health_connect', ...values })
        .onConflictDoUpdate({ target: t.hcSyncState.key, set: values })
        .run();
    },

    upsertDailyMetrics(rows) {
      const syncedAt = now();
      db.transaction((tx) => {
        for (const r of rows) {
          // Only fields Health Connect returned overwrite, so a steps-only read keeps resting HR.
          const set: Partial<typeof t.dailyMetrics.$inferInsert> = { source: r.source, syncedAt, ...stamp() };
          if (r.steps !== undefined) set.steps = r.steps;
          if (r.restingHr !== undefined) set.restingHr = r.restingHr;
          if (r.activeKcal !== undefined) set.activeKcal = r.activeKcal;
          if (r.sleepMin !== undefined) set.sleepMin = r.sleepMin;
          tx.insert(t.dailyMetrics)
            .values({ date: r.date, source: r.source, syncedAt, ...set, ...stamp() })
            .onConflictDoUpdate({ target: t.dailyMetrics.date, set })
            .run();
        }
      });
    },

    dailyMetrics(date) {
      const r = db.select().from(t.dailyMetrics).where(and(eq(t.dailyMetrics.date, date), notDeleted(t.dailyMetrics))).get();
      if (!r) return undefined;
      const m: DailyMetrics = { date: r.date, source: r.source, syncedAt: new Date(r.syncedAt).toISOString() };
      if (r.steps !== null) m.steps = r.steps;
      if (r.restingHr !== null) m.restingHr = r.restingHr;
      if (r.activeKcal !== null) m.activeKcal = r.activeKcal;
      if (r.sleepMin !== null) m.sleepMin = r.sleepMin;
      return m;
    },

    importExternalSessions(inputs) {
      const prefs = repo.settings().healthConnect;
      const result: HealthImportResult = { merged: [], added: [] };
      if (!prefs.importWorkouts) return result;
      const allowed = inputs.filter((i) => prefs.allSources || i.originPackage === GARMIN_CONNECT_PACKAGE);
      if (allowed.length === 0) return result;
      const known = new Set(
        db
          .select({ hc: t.externalSessions.hcRecordId })
          .from(t.externalSessions)
          .where(
            inArray(
              t.externalSessions.hcRecordId,
              allowed.map((i) => i.hcRecordId),
            ),
          )
          .all()
          .map((r) => r.hc),
      );
      const fresh = allowed.filter((i) => !known.has(i.hcRecordId));
      if (fresh.length === 0) return result;
      const minStart = Math.min(...fresh.map((i) => Date.parse(i.startedAt)));
      const phone = db
        .select({ id: t.sessions.id, name: t.sessions.name, startMs: t.sessions.startedAt, endMs: t.sessions.endedAt })
        .from(t.sessions)
        .where(and(eq(t.sessions.status, 'saved'), notDeleted(t.sessions), gte(t.sessions.endedAt, minStart)))
        .all()
        .filter((s): s is { id: string; name: string; startMs: number; endMs: number } => s.endMs !== null);

      const added: string[] = [];
      db.transaction((tx) => {
        for (const input of fresh) {
          const id = newId();
          const startMs = Date.parse(input.startedAt);
          const endMs = Date.parse(input.endedAt);
          const target = findMergeTarget({ startMs, endMs }, phone);
          tx.insert(t.externalSessions)
            .values({
              id,
              hcRecordId: input.hcRecordId,
              originPackage: input.originPackage,
              activity: input.activity,
              title: input.title?.trim() || ACTIVITY_TITLES[input.activity],
              startedAt: startMs,
              endedAt: endMs,
              distanceM: input.distanceM ?? null,
              activeKcal: input.activeKcal ?? null,
              avgHr: input.avgHr ?? null,
              maxHr: input.maxHr ?? null,
              hasRoute: input.hasRoute,
              status: target ? 'merged' : 'new',
              linkedSessionId: target?.id ?? null,
              ...created(),
            })
            .run();
          if (target) result.merged.push({ externalId: id, sessionId: target.id, sessionName: target.name });
          else added.push(id);
        }
      });

      for (const id of added) {
        if (prefs.autoMatch) {
          // Auto-match only when the suggestion is the one strong candidate (spec §11 Settings).
          const { suggested, candidates } = repo.planMatch(id);
          const rivals = candidates.filter((c) => suggested && c.lane === suggested.lane && c.date === suggested.date);
          if (suggested && rivals.length === 1) {
            const ext = repo.externalSession(id)!;
            repo.saveExternal(id, { planKey: suggested.key, title: ext.title, activity: ext.activity });
          }
        }
        result.added.push(repo.externalSession(id)!);
      }
      return result;
    },

    sessionsNeedingHr(since) {
      if (!repo.settings().healthConnect.addHr) return [];
      const rows = db
        .select({ id: t.sessions.id, startedAt: t.sessions.startedAt, endedAt: t.sessions.endedAt })
        .from(t.sessions)
        .where(and(eq(t.sessions.status, 'saved'), notDeleted(t.sessions), isNull(t.sessions.hrFilledAt), gte(t.sessions.startedAt, Date.parse(since))))
        .all();
      const ended = rows.filter((r): r is typeof r & { endedAt: number } => r.endedAt !== null);
      if (ended.length === 0) return [];
      // One query for every candidate's live trace, not one per session.
      const live = new Map<string, HrSample[]>();
      const samples = db
        .select({ sessionId: t.hrSamples.sessionId, tOffsetMs: t.hrSamples.tOffsetMs, bpm: t.hrSamples.bpm })
        .from(t.hrSamples)
        .where(
          and(
            inArray(
              t.hrSamples.sessionId,
              ended.map((r) => r.id),
            ),
            eq(t.hrSamples.source, 'ble'),
          ),
        )
        .orderBy(asc(t.hrSamples.sessionId), asc(t.hrSamples.tOffsetMs))
        .all();
      for (const s of samples) {
        let list = live.get(s.sessionId);
        if (!list) live.set(s.sessionId, (list = []));
        list.push({ tOffsetMs: s.tOffsetMs, bpm: s.bpm, source: 'ble' });
      }
      const out: HrWindow[] = [];
      for (const r of ended) {
        const trace = live.get(r.id);
        if (trace && hrGaps(trace, r.endedAt - r.startedAt).length === 0) continue;
        out.push({ sessionId: r.id, startedAt: new Date(r.startedAt).toISOString(), endedAt: new Date(r.endedAt).toISOString() });
      }
      return out;
    },

    addHealthHr(sessionId, samples) {
      if (samples.length === 0) return;
      const row = db.select().from(t.sessions).where(eq(t.sessions.id, sessionId)).get();
      if (!row) throw new Error(`Unknown session ${sessionId}`);
      const endOffset = (row.endedAt ?? now()) - row.startedAt;
      const rows = samples
        .map((s) => ({ sessionId, tOffsetMs: Date.parse(s.time) - row.startedAt, bpm: Math.round(s.bpm), source: 'health_connect' as const }))
        .filter((s) => s.tOffsetMs >= 0 && s.tOffsetMs <= endOffset);
      db.transaction((tx) => {
        tx.delete(t.hrSamples)
          .where(and(eq(t.hrSamples.sessionId, sessionId), eq(t.hrSamples.source, 'health_connect')))
          .run();
        for (let i = 0; i < rows.length; i += HR_BATCH) {
          tx.insert(t.hrSamples)
            .values(rows.slice(i, i + HR_BATCH))
            .onConflictDoNothing()
            .run();
        }
        // New HR changes Zone 2 time and decoupling; stats are recomputed on next use.
        tx.update(t.sessions)
          .set({ hrFilledAt: now(), statsJson: null, ...stamp() })
          .where(eq(t.sessions.id, sessionId))
          .run();
      });
    },

    pendingExternal() {
      return db
        .select()
        .from(t.externalSessions)
        .where(and(eq(t.externalSessions.status, 'new'), notDeleted(t.externalSessions)))
        .orderBy(asc(t.externalSessions.startedAt))
        .all()
        .map(toExternal);
    },

    externalSessions(start, end) {
      const from = new Date(`${start}T00:00:00`).getTime();
      const to = new Date(`${addDays(end, 1)}T00:00:00`).getTime();
      return db
        .select()
        .from(t.externalSessions)
        .where(and(eq(t.externalSessions.status, 'saved'), notDeleted(t.externalSessions), gte(t.externalSessions.startedAt, from), lt(t.externalSessions.startedAt, to)))
        .orderBy(asc(t.externalSessions.startedAt))
        .all()
        .map(toExternal);
    },

    externalSession(id) {
      const r = db
        .select()
        .from(t.externalSessions)
        .where(and(eq(t.externalSessions.id, id), notDeleted(t.externalSessions)))
        .get();
      return r ? toExternal(r) : undefined;
    },

    planMatch(externalId) {
      const ext = repo.externalSession(externalId);
      if (!ext) throw new Error(`Unknown external session ${externalId}`);
      const day = localIsoDate(new Date(ext.startedAt));
      return matchPlanItem(
        { startMs: Date.parse(ext.startedAt), endMs: Date.parse(ext.endedAt), activity: ext.activity },
        repo.agenda(addDays(day, -1), addDays(day, 3)),
      );
    },

    saveExternal(id, save) {
      const ext = repo.externalSession(id);
      if (!ext) throw new Error(`Unknown external session ${id}`);
      db.update(t.externalSessions)
        .set({ status: 'saved', title: save.title, activity: save.activity, rpe: save.rpe ?? null, note: save.note ?? null, linkedPlanKey: save.planKey ?? null, ...stamp() })
        .where(eq(t.externalSessions.id, id))
        .run();
      if (!save.planKey) return;
      const endedAt = Date.parse(ext.endedAt);
      const details: CompletionDetails = { minutes: Math.round((endedAt - Date.parse(ext.startedAt)) / 60000) };
      if (ext.distanceM !== undefined) details.distanceM = ext.distanceM;
      if (save.rpe !== undefined) details.rpe = save.rpe;
      if (save.note) details.note = save.note;
      if (parseOccurrenceKey(save.planKey)) {
        upsertCompletion(save.planKey, 'done', { completedAt: endedAt, details, externalSessionId: id });
        return;
      }
      db.update(t.planWorkouts)
        .set({ status: 'done', completedAt: endedAt, skipReason: null, externalSessionId: id, ...completionDetails(details), ...stamp() })
        .where(eq(t.planWorkouts.id, save.planKey))
        .run();
    },

    ignoreExternal(id) {
      db.update(t.externalSessions)
        .set({ status: 'ignored', ...stamp() })
        .where(eq(t.externalSessions.id, id))
        .run();
    },

    undoMerge(externalId) {
      const ext = db.select().from(t.externalSessions).where(eq(t.externalSessions.id, externalId)).get();
      if (!ext || ext.status !== 'merged' || !ext.linkedSessionId) return;
      const sessionId = ext.linkedSessionId;
      db.transaction((tx) => {
        tx.update(t.externalSessions)
          .set({ status: 'new', linkedSessionId: null, ...stamp() })
          .where(eq(t.externalSessions.id, externalId))
          .run();
        tx.delete(t.hrSamples)
          .where(and(eq(t.hrSamples.sessionId, sessionId), eq(t.hrSamples.source, 'health_connect')))
          .run();
        // -1 keeps sessionsNeedingHr from adding the same HR back on the next sync.
        tx.update(t.sessions)
          .set({ hrFilledAt: -1, statsJson: null, ...stamp() })
          .where(eq(t.sessions.id, sessionId))
          .run();
      });
    },

    runRows(start, end) {
      backfillStats();
      const from = dayStartMs(start);
      const to = dayStartMs(addDays(end, 1));
      const rows: RunRow[] = db
        .select({ id: t.sessions.id, startedAt: t.sessions.startedAt, distanceM: t.sessions.distanceM, elapsedMs: t.sessions.elapsedMs, statsJson: t.sessions.statsJson })
        .from(t.sessions)
        .where(and(eq(t.sessions.status, 'saved'), eq(t.sessions.kind, 'run'), notDeleted(t.sessions), gte(t.sessions.startedAt, from), lt(t.sessions.startedAt, to)))
        .all()
        .map((r) => ({
          sessionId: r.id,
          date: localIsoDate(new Date(r.startedAt)),
          distanceM: r.distanceM,
          durationS: Math.round(r.elapsedMs / 1000),
          ...(r.statsJson ? { stats: JSON.parse(r.statsJson) as SessionStats } : {}),
        }));
      const external = db
        .select()
        .from(t.externalSessions)
        .where(
          and(
            eq(t.externalSessions.status, 'saved'),
            inArray(t.externalSessions.activity, EXTERNAL_RUNS),
            notDeleted(t.externalSessions),
            gte(t.externalSessions.startedAt, from),
            lt(t.externalSessions.startedAt, to),
          ),
        )
        .all();
      for (const e of external) {
        rows.push({
          sessionId: e.id,
          date: localIsoDate(new Date(e.startedAt)),
          distanceM: e.distanceM ?? 0,
          durationS: Math.round((e.endedAt - e.startedAt) / 1000),
          ...(EXTERNAL_KIND[e.activity as ExternalActivity] === 'walk' ? { walk: true } : {}),
        });
      }
      return rows.sort((a, b) => a.date.localeCompare(b.date));
    },

    personalBests() {
      backfillStats();
      const rows = db
        .select({ id: t.sessions.id, startedAt: t.sessions.startedAt, statsJson: t.sessions.statsJson })
        .from(t.sessions)
        .where(and(eq(t.sessions.status, 'saved'), eq(t.sessions.kind, 'run'), eq(t.sessions.mode, 'outdoor'), notDeleted(t.sessions)))
        .all();
      return fastestEfforts(
        rows.flatMap((r) => (r.statsJson ? [{ sessionId: r.id, date: localIsoDate(new Date(r.startedAt)), stats: JSON.parse(r.statsJson) as SessionStats }] : [])),
      );
    },

    history(filter) {
      const before = filter.before ? Date.parse(filter.before) : undefined;
      const search = filter.search?.trim().toLowerCase();
      const items: HistoryItem[] = [];
      const fitKind = filter.kind === 'run' || filter.kind === 'strength' ? filter.kind : filter.kind ? undefined : null;
      if (filter.source !== 'external' && fitKind !== undefined) {
        const conds = [eq(t.sessions.status, 'saved'), notDeleted(t.sessions)];
        if (fitKind) conds.push(eq(t.sessions.kind, fitKind));
        if (filter.mode) conds.push(eq(t.sessions.mode, filter.mode));
        if (before !== undefined) conds.push(lt(t.sessions.startedAt, before));
        if (search) conds.push(sql`instr(lower(${t.sessions.name}), ${search}) > 0`);
        for (const r of db.select().from(t.sessions).where(and(...conds)).orderBy(desc(t.sessions.startedAt)).limit(filter.limit).all()) {
          items.push({
            id: r.id,
            source: 'fit',
            kind: r.kind,
            mode: r.mode,
            name: r.name,
            startedAt: new Date(r.startedAt).toISOString(),
            durationS: Math.round(r.elapsedMs / 1000),
            ...(r.kind === 'run' ? { distanceM: r.distanceM } : {}),
          });
        }
      }
      // Watch activities have no mode, except treadmill runs, which match a treadmill filter.
      if (filter.source !== 'fit' && (!filter.mode || filter.mode === 'treadmill')) {
        const activities = (Object.keys(EXTERNAL_KIND) as ExternalActivity[]).filter(
          (a) => (!filter.kind || EXTERNAL_KIND[a] === filter.kind) && (!filter.mode || a === 'treadmill'),
        );
        const conds = [eq(t.externalSessions.status, 'saved'), notDeleted(t.externalSessions), inArray(t.externalSessions.activity, activities)];
        if (before !== undefined) conds.push(lt(t.externalSessions.startedAt, before));
        if (search) conds.push(sql`instr(lower(${t.externalSessions.title}), ${search}) > 0`);
        for (const r of db.select().from(t.externalSessions).where(and(...conds)).orderBy(desc(t.externalSessions.startedAt)).limit(filter.limit).all()) {
          items.push({
            id: r.id,
            source: 'external',
            kind: EXTERNAL_KIND[r.activity as ExternalActivity],
            ...(r.activity === 'treadmill' ? { mode: 'treadmill' as const } : {}),
            name: r.title,
            startedAt: new Date(r.startedAt).toISOString(),
            durationS: Math.round((r.endedAt - r.startedAt) / 1000),
            ...(r.distanceM !== null ? { distanceM: r.distanceM } : {}),
            originPackage: r.originPackage,
          });
        }
      }
      return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, filter.limit);
    },

    dailyMetricsRange(start, end) {
      return db
        .select()
        .from(t.dailyMetrics)
        .where(and(gte(t.dailyMetrics.date, start), lte(t.dailyMetrics.date, end), notDeleted(t.dailyMetrics)))
        .orderBy(asc(t.dailyMetrics.date))
        .all()
        .map((r) => {
          const m: DailyMetrics = { date: r.date, source: r.source, syncedAt: new Date(r.syncedAt).toISOString() };
          if (r.steps !== null) m.steps = r.steps;
          if (r.restingHr !== null) m.restingHr = r.restingHr;
          if (r.activeKcal !== null) m.activeKcal = r.activeKcal;
          if (r.sleepMin !== null) m.sleepMin = r.sleepMin;
          return m;
        });
    },

    strengthDays(start, end) {
      return db
        .select({ id: t.sessions.id, startedAt: t.sessions.startedAt, routineId: t.sessions.routineId, summaryJson: t.sessions.summaryJson })
        .from(t.sessions)
        .where(
          and(
            eq(t.sessions.status, 'saved'),
            eq(t.sessions.kind, 'strength'),
            notDeleted(t.sessions),
            gte(t.sessions.startedAt, dayStartMs(start)),
            lt(t.sessions.startedAt, dayStartMs(addDays(end, 1))),
          ),
        )
        .orderBy(asc(t.sessions.startedAt))
        .all()
        .map((r) => ({
          sessionId: r.id,
          date: localIsoDate(new Date(r.startedAt)),
          ...(r.routineId ? { routineId: r.routineId } : {}),
          volumeKg: r.summaryJson ? ((JSON.parse(r.summaryJson) as { volumeKg?: number }).volumeKg ?? 0) : 0,
        }));
    },

    routineDays(start, end) {
      return db
        .select({ routineId: t.routineCompletions.routineId, date: t.routineCompletions.date, detailsJson: t.routineCompletions.detailsJson })
        .from(t.routineCompletions)
        .where(
          and(
            eq(t.routineCompletions.status, 'done'),
            gte(t.routineCompletions.date, start),
            lte(t.routineCompletions.date, end),
            notDeleted(t.routineCompletions),
          ),
        )
        .orderBy(asc(t.routineCompletions.date))
        .all()
        .map((r) => {
          const minutes = r.detailsJson ? (JSON.parse(r.detailsJson) as CompletionDetails).minutes : undefined;
          return { routineId: r.routineId, date: r.date, ...(minutes !== undefined ? { minutes } : {}) };
        });
    },

    aerobicTests() {
      const rows = db
        .select({ s: t.sessions })
        .from(t.sessions)
        .innerJoin(t.planWorkouts, eq(t.planWorkouts.id, t.sessions.planWorkoutId))
        .where(and(eq(t.planWorkouts.role, 'retest'), eq(t.sessions.status, 'saved'), notDeleted(t.sessions)))
        .orderBy(asc(t.sessions.startedAt))
        .all();
      const tests: AerobicTest[] = [];
      for (const { s } of rows) {
        const player = JSON.parse(s.playerJson) as PlayerState;
        const results = stepResults(player.steps, player.log);
        // The test step: the longest completed HR step of 20 min or more.
        let pick: number | undefined;
        results.forEach((r, i) => {
          const isHr = r.step.target.type === 'hr_zone' || r.step.target.type === 'hr_range';
          if (isHr && !r.skipped && r.durationS >= 1200 && (pick === undefined || r.durationS > results[pick]!.durationS)) pick = i;
        });
        if (pick === undefined) continue;
        const r = results[pick]!;
        const entry = player.log[pick]!;
        const beats = sessionHr(s.id, (s.endedAt ?? s.startedAt) - s.startedAt).filter((h) => h.tOffsetMs >= entry.startOffsetMs && h.tOffsetMs < entry.endOffsetMs);
        const test: AerobicTest = { sessionId: s.id, date: localIsoDate(new Date(s.startedAt)), mode: s.mode, durationS: Math.round(r.durationS) };
        if (r.avgPaceSecPerKm !== undefined) test.secPerKm = Math.round(r.avgPaceSecPerKm);
        if (beats.length > 0) test.avgBpm = Math.round(beats.reduce((sum, h) => sum + h.bpm, 0) / beats.length);
        tests.push(test);
      }
      return tests;
    },

    learnedZone2Pace(today) {
      return medianZone2Pace(repo.runRows(addDays(today, -120), today));
    },

    settings(): Settings {
      const rows = db.select().from(t.settings).where(notDeleted(t.settings)).all();
      const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      for (const r of rows) {
        if (INTERNAL_SETTING_KEYS.has(r.key)) continue;
        const value = JSON.parse(r.valueJson) as unknown;
        const base = merged[r.key];
        // Object settings keep defaults for fields added after they were saved (e.g. new cue prefs).
        const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
        merged[r.key] = isObject(base) && isObject(value) ? { ...(base as object), ...(value as object) } : value;
      }
      return merged as unknown as Settings;
    },

    updateSettings(patch) {
      db.transaction((tx) => {
        for (const [key, value] of Object.entries(patch)) {
          // undefined clears an optional setting (e.g. forgetting the HR sensor).
          if (value === undefined) {
            tx.update(t.settings)
              .set({ deletedAt: now(), ...stamp() })
              .where(eq(t.settings.key, key))
              .run();
            continue;
          }
          const valueJson = JSON.stringify(value);
          tx.insert(t.settings)
            .values({ key, valueJson, ...stamp() })
            .onConflictDoUpdate({ target: t.settings.key, set: { valueJson, deletedAt: null, ...stamp() } })
            .run();
        }
      });
    },
  };
  return repo;
}

