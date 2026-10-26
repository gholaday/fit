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
  localIsoDate,
} from '@fit/core';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as t from './sqlite';
import { STARTER_ROUTINES } from './starter';

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
};

interface RoutineItems {
  items: { name: string }[];
  estSeconds: number;
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

  function routineMap(): Map<string, RoutineInfo & { itemCount: number }> {
    const rows = db.select().from(t.routines).where(notDeleted(t.routines)).all();
    return new Map(
      rows.map((r) => {
        const parsed = JSON.parse(r.itemsJson) as RoutineItems;
        return [r.id, { name: r.name, kind: r.kind, estSeconds: parsed.estSeconds, itemCount: parsed.items.length }];
      }),
    );
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

  function upsertCompletion(key: string, status: 'done' | 'skipped', extra: { completedAt?: number; details?: CompletionDetails; skipReason?: SkipReason }) {
    const occ = parseOccurrenceKey(key);
    if (!occ) throw new Error(`Not a schedule occurrence: ${key}`);
    const entry = db.select().from(t.weeklySchedule).where(eq(t.weeklySchedule.id, occ.scheduleId)).get();
    if (!entry) throw new Error(`Unknown schedule entry ${occ.scheduleId}`);
    const values = {
      status,
      completedAt: extra.completedAt ?? null,
      detailsJson: extra.details ? JSON.stringify(extra.details) : null,
      skipReason: extra.skipReason ?? null,
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

  function seedStarterRoutines() {
    const any = db.select({ id: t.routines.id }).from(t.routines).limit(1).get();
    if (any) return;
    db.transaction((tx) => {
      for (const r of STARTER_ROUTINES) {
        tx.insert(t.routines)
          .values({
            id: newId(),
            kind: r.kind,
            name: r.name,
            itemsJson: JSON.stringify({ items: r.items.map((name) => ({ name })), estSeconds: r.estSeconds } satisfies RoutineItems),
            origin: 'starter',
            ...created(),
          })
          .run();
      }
    });
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

  seedStarterRoutines();

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
            .values({ id: newId(), vdot: plan.vdot, source: 'goal', sourceDetailJson: JSON.stringify({ meters: 5000, seconds: inputs.goalSeconds }), isCurrent: true, ...created() })
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
      return [...routineMap()].map(([id, r]) => ({ id, kind: r.kind, name: r.name, itemCount: r.itemCount, estSeconds: r.estSeconds }));
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

