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
  totalMeters,
  WORKOUT_ITEMS_SCHEMA_VERSION,
  z2Minutes,
  zonePace,
  type AgendaItem,
  type Clock,
  type CompletionDetails,
  type FitRepository,
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
  DEFAULT_CUE_PREFS,
  localIsoDate,
  routineSeconds,
  stepResults,
  volumeKg,
} from '@fit/core';
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, ne, or } from 'drizzle-orm';
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
};

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
  if (r.origin === 'seed' && (JSON.parse(r.imageKeysJson) as string[]).length > 0) s.thumbKey = r.slug;
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

  function upsertCompletion(key: string, status: 'done' | 'skipped', extra: { completedAt?: number; details?: CompletionDetails; skipReason?: SkipReason; sessionId?: string }) {
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
    const currentWeek = Math.min(info.weeks, Math.max(1, Math.floor(diffDays(week1, onDate) / 7) + 1));
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
      weeks: info.weeks,
      currentWeek,
      measure:
        info.measure === 'z2_minutes'
          ? { kind: 'z2_minutes', planned: Math.round(planned), done: Math.round(done) }
          : { kind: 'distance', plannedM: Math.round(planned), doneM: Math.round(done) },
      inputs,
    };
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

  return {
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
              sourceDetailJson: JSON.stringify(recentRace ?? { meters: 5000, seconds: inputs.goalSeconds }),
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

    currentVdot() {
      return db.select({ vdot: t.paceProfiles.vdot }).from(t.paceProfiles).where(and(eq(t.paceProfiles.isCurrent, true), notDeleted(t.paceProfiles))).get()?.vdot;
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
        for (const p of progress.points) {
          tx.insert(t.trackPoints)
            .values({ sessionId: id, tOffsetMs: p.tOffsetMs, lat: p.lat, lng: p.lng, alt: p.alt ?? null, accuracy: p.accuracy, speed: p.speed ?? null })
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
      db.transaction((tx) => {
        tx.update(t.sessions)
          .set({
            status: 'saved',
            endedAt,
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
      };
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

    catalogVersion() {
      const row = db.select().from(t.settings).where(eq(t.settings.key, 'catalogVersion')).get();
      return row ? (JSON.parse(row.valueJson) as string) : undefined;
    },

    seedCatalog(catalog) {
      db.transaction((tx) => {
        for (const e of catalog.exercises) {
          const values = {
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
          };
          // Hidden flags are yours; an update never touches them.
          tx.insert(t.exercises)
            .values({ id: e.id, ...values, origin: 'seed', ...created() })
            .onConflictDoUpdate({ target: t.exercises.id, set: { ...values, deletedAt: null, ...stamp() } })
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

    settings(): Settings {
      const rows = db.select().from(t.settings).where(notDeleted(t.settings)).all();
      const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.valueJson) as unknown]));
      return { ...DEFAULT_SETTINGS, ...stored } as Settings;
    },

    updateSettings(patch) {
      db.transaction((tx) => {
        for (const [key, value] of Object.entries(patch)) {
          const valueJson = JSON.stringify(value);
          tx.insert(t.settings)
            .values({ key, valueJson, ...stamp() })
            .onConflictDoUpdate({ target: t.settings.key, set: { valueJson, deletedAt: null, ...stamp() } })
            .run();
        }
      });
    },
  };
}

