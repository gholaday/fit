/**
 * In-memory FitRepository seeded from the mockup data, used until
 * `createSqliteRepository(db)` lands in @fit/schema. It keeps just enough behavior to
 * exercise every M0 screen: plan workouts on dates, weekly schedule occurrences with
 * per-occurrence overrides, and completion state. The real plan generation and
 * schedule expansion live in @fit/core and @fit/schema; this is a stand-in only.
 */
import {
  type AgendaItem,
  type AgendaStatus,
  type Clock,
  type CompletionDetails,
  type FitRepository,
  type HrProfile,
  type HrProfileInput,
  type IsoDate,
  type MoveScope,
  type PlanInputs,
  type PlanRole,
  type PlanSummary,
  type QuickLog,
  type Routine,
  type ScheduleEntry,
  type Settings,
  type SkipReason,
  type Step,
  type Target,
  type Weekday,
  type WorkoutItem,
  DEFAULT_UNITS,
  addDays,
  computeZones,
  dateRange,
  diffDays,
  localIsoDate,
  startOfWeek,
  structureSegments,
  totalMeters,
  totalSeconds,
  weekdayOf,
  zoneBand,
} from '@fit/core';

interface PlanWorkoutRow {
  id: string;
  planId: string;
  weekIndex: number;
  role: PlanRole;
  date: IsoDate;
  title: string;
  items: WorkoutItem[];
  hrZone2: boolean;
}

interface Override {
  date?: IsoDate;
  status?: AgendaStatus;
  completedAt?: string;
  details?: CompletionDetails;
  skipReason?: SkipReason;
}

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

function mk(activity: 'walk' | 'run' | 'sprint', minutes: number, target: Target): Step {
  return { id: id('st'), activity, duration: { type: 'time', seconds: minutes * 60 }, target };
}

function z2Run(minutes: number): WorkoutItem[] {
  return [mk('walk', 5, { type: 'none' }), mk('run', minutes - 10, { type: 'hr_zone', zone: 2 }), mk('walk', 5, { type: 'none' })];
}

function intervals(reps: number): WorkoutItem[] {
  return [
    mk('run', 10, { type: 'pace_zone', zone: 'easy' }),
    { id: id('rp'), repeat: reps, steps: [mk('run', 3, { type: 'pace_zone', zone: 'interval' }), mk('walk', 2, { type: 'none' })] },
    mk('run', 10, { type: 'pace_zone', zone: 'easy' }),
  ];
}

function tempo(minutes: number): WorkoutItem[] {
  return [mk('run', 10, { type: 'pace_zone', zone: 'easy' }), mk('run', minutes, { type: 'pace_zone', zone: 'tempo' }), mk('run', 10, { type: 'pace_zone', zone: 'easy' })];
}

function easy(minutes: number): WorkoutItem[] {
  return [mk('run', minutes, { type: 'pace_zone', zone: 'easy' })];
}

const SEED_ROUTINES: Routine[] = [
  { id: 'rt_pull', kind: 'strength', name: 'Pull', itemCount: 6, estSeconds: 50 * 60 },
  { id: 'rt_push', kind: 'strength', name: 'Push', itemCount: 5, estSeconds: 50 * 60 },
  { id: 'rt_legs', kind: 'strength', name: 'Legs', itemCount: 5, estSeconds: 45 * 60 },
  { id: 'rt_morning', kind: 'stretch', name: 'Morning stretch', itemCount: 6, estSeconds: 8 * 60 },
  { id: 'rt_evening', kind: 'stretch', name: 'Evening stretch', itemCount: 7, estSeconds: 9 * 60 },
];

function seedSchedule(): ScheduleEntry[] {
  const out: ScheduleEntry[] = [];
  const add = (weekday: Weekday, routineId: string, slot: ScheduleEntry['slot'], time?: string) =>
    out.push({ id: `sc_${routineId}_${weekday}`, weekday, routineId, slot, time, reminder: time !== undefined, position: out.length });
  add(1, 'rt_pull', 'any');
  add(2, 'rt_push', 'any');
  add(4, 'rt_legs', 'any');
  for (let w = 1 as Weekday; w <= 7; w = (w + 1) as Weekday) add(w, 'rt_morning', 'morning', '07:00');
  for (let w = 1 as Weekday; w <= 5; w = (w + 1) as Weekday) add(w, 'rt_evening', 'evening', '21:30');
  return out;
}

const PRESET_NAMES: Record<PlanInputs['presetId'], string> = { '5k-8wk': '5K', 'z2-base-8wk': 'Zone 2 Base' };
const HARD_ROLES: ReadonlySet<PlanRole> = new Set(['long', 'quality', 'quality2', 'retest']);

/**
 * Simple stand-in scheduler: roles on the chosen days, long run on the long-run day.
 * Not the real generator (that is @fit/core plan generation).
 */
function fakeGenerate(planId: string, inputs: PlanInputs, start: IsoDate, weeks: number): PlanWorkoutRow[] {
  const days = [...inputs.preferredDays].sort((a, b) => a - b).slice(0, inputs.daysPerWeek);
  if (!days.includes(inputs.longRunDay)) days[days.length - 1] = inputs.longRunDay;
  const others = days.filter((d) => d !== inputs.longRunDay);
  const rows: PlanWorkoutRow[] = [];
  const z2 = inputs.presetId === 'z2-base-8wk';
  for (let w = 0; w < weeks; w++) {
    const cutback = (w + 1) % 4 === 0 ? 0.7 : 1;
    const weekStart = addDays(start, 7 * w);
    const push = (weekday: Weekday, role: PlanRole, title: string, items: WorkoutItem[]) =>
      rows.push({ id: id('pw'), planId, weekIndex: w, role, date: addDays(weekStart, weekday - 1), title, items, hrZone2: z2 });
    const longMin = Math.round(((z2 ? 50 : 40) + w * 5) * cutback);
    push(inputs.longRunDay, 'long', z2 ? 'Zone 2 Long Run' : 'Long Run', z2 ? z2Run(longMin) : easy(longMin));
    others.forEach((weekday, i) => {
      if (z2) push(weekday, i === 0 ? 'easy' : 'easy2', 'Zone 2 Run', z2Run(Math.round((35 + w * 2) * cutback)));
      else if (i === 0) push(weekday, 'quality', 'Intervals', intervals(4 + Math.min(4, Math.floor(w / 2))));
      else if (i === 1) push(weekday, 'quality2', 'Tempo Run', tempo(15 + w * 2));
      else push(weekday, 'easy', 'Easy Run', easy(30));
    });
  }
  return rows;
}

export function createFakeRepository(clock: Clock = () => new Date()): FitRepository {
  const today = () => localIsoDate(clock());

  let settings: Settings = { units: DEFAULT_UNITS, stepGoal: 8000, easyBy: 'hr', onboarded: false };
  let hrProfile: HrProfile | undefined;
  const routines = SEED_ROUTINES;
  let schedule = seedSchedule();
  const overrides = new Map<string, Override>();
  const quickLogs: QuickLog[] = [];
  let plan: (Omit<PlanSummary, 'currentWeek' | 'measure'> & { abandoned: boolean }) | undefined;
  let planWorkouts: PlanWorkoutRow[] = [];

  function setHr(input: HrProfileInput): HrProfile {
    hrProfile = { ...input, id: id('hr'), zones: computeZones(input), createdAt: clock().toISOString() };
    return hrProfile;
  }

  function startPlan(inputs: PlanInputs, startDate: IsoDate): PlanSummary {
    const planId = id('pl');
    const weeks = 8;
    const start = startOfWeek(startDate);
    plan = {
      id: planId,
      presetId: inputs.presetId,
      name: PRESET_NAMES[inputs.presetId],
      startDate: start,
      endDate: addDays(start, weeks * 7 - 1),
      weeks,
      inputs,
      abandoned: false,
    };
    planWorkouts = fakeGenerate(planId, inputs, start, weeks);
    return summary(today())!;
  }

  // Seed: Zone 2 Base in week 3, Tue/Thu/Fri runs and a Sunday long run, as in Plan.html.
  setHr({ method: 'hrr', maxHr: 186, maxHrSource: 'estimated', restingHr: 58, age: 31 });
  startPlan(
    { presetId: 'z2-base-8wk', startDate: addDays(startOfWeek(today()), -14), daysPerWeek: 4, preferredDays: [2, 4, 5, 7], longRunDay: 7, easyBy: 'hr', treadmill: 'none' },
    addDays(startOfWeek(today()), -14),
  );
  // Mockup state: yesterday's items done when today is not Monday.
  const seedNow = today();
  for (const d of dateRange(startOfWeek(seedNow), addDays(seedNow, -1))) {
    for (const item of agendaRaw(d, d)) overrides.set(item.key, { status: 'done', completedAt: `${d}T18:00:00.000Z` });
  }
  const morning = agendaRaw(seedNow, seedNow).find((i) => i.slot === 'morning');
  if (morning) overrides.set(morning.key, { status: 'done', completedAt: `${seedNow}T07:10:00.000Z` });

  function routine(routineId: string): Routine | undefined {
    return routines.find((r) => r.id === routineId);
  }

  function hrRangeForZ2(): { minBpm: number; maxBpm: number } | undefined {
    if (!hrProfile) return undefined;
    const band = zoneBand(hrProfile.zones, 2);
    return { minBpm: band.minBpm, maxBpm: band.maxBpm };
  }

  function planItem(row: PlanWorkoutRow): AgendaItem {
    const o = overrides.get(row.id);
    const secs = totalSeconds(row.items);
    return {
      key: row.id,
      lane: 'run',
      date: o?.date ?? row.date,
      originalDate: row.date,
      source: { type: 'plan_workout', planWorkoutId: row.id, planId: row.planId, weekIndex: row.weekIndex, role: row.role },
      title: row.title,
      refId: row.id,
      hard: HARD_ROLES.has(row.role) && !row.hrZone2,
      estSeconds: secs,
      estMeters: row.hrZone2 ? (secs / 60) * 135 : totalMeters(row.items),
      structure: structureSegments(row.items),
      hrRange: row.hrZone2 ? hrRangeForZ2() : undefined,
      status: o?.status ?? 'pending',
      completedAt: o?.completedAt,
      details: o?.details,
      skipReason: o?.skipReason,
    };
  }

  function scheduleItem(entry: ScheduleEntry, originalDate: IsoDate): AgendaItem | undefined {
    const r = routine(entry.routineId);
    if (!r) return undefined;
    const key = `${entry.id}@${originalDate}`;
    const o = overrides.get(key);
    return {
      key,
      lane: r.kind === 'strength' ? 'workout' : 'stretch',
      date: o?.date ?? originalDate,
      originalDate,
      source: { type: 'schedule', scheduleId: entry.id, routineId: r.id },
      title: r.name,
      refId: r.id,
      slot: entry.slot,
      time: entry.time,
      hard: false,
      estSeconds: r.estSeconds,
      status: o?.status ?? 'pending',
      completedAt: o?.completedAt,
      details: o?.details,
      skipReason: o?.skipReason,
    };
  }

  function agendaRaw(start: IsoDate, end: IsoDate): AgendaItem[] {
    const out: AgendaItem[] = [];
    if (plan && !plan.abandoned) {
      for (const row of planWorkouts) {
        const item = planItem(row);
        if (item.date >= start && item.date <= end) out.push(item);
      }
    }
    // Expand a margin around the range so occurrences moved into it are found.
    for (const d of dateRange(addDays(start, -14), addDays(end, 14))) {
      const wd = weekdayOf(d);
      for (const entry of schedule) {
        if (entry.weekday !== wd) continue;
        const item = scheduleItem(entry, d);
        if (item && item.date >= start && item.date <= end) out.push(item);
      }
    }
    const slotRank = (i: AgendaItem) => (i.slot === 'morning' ? 0 : i.slot === 'evening' ? 2 : 1);
    return out.sort((a, b) => a.date.localeCompare(b.date) || slotRank(a) - slotRank(b) || (a.time ?? '').localeCompare(b.time ?? '') || laneRank(a) - laneRank(b));
  }

  function laneRank(i: AgendaItem): number {
    return i.lane === 'run' ? 0 : i.lane === 'workout' ? 1 : 2;
  }

  function findItem(key: string): AgendaItem | undefined {
    const row = planWorkouts.find((r) => r.id === key);
    if (row) return planItem(row);
    const at = key.lastIndexOf('@');
    if (at < 0) return undefined;
    const entry = schedule.find((e) => e.id === key.slice(0, at));
    return entry ? scheduleItem(entry, key.slice(at + 1)) : undefined;
  }

  function patch(key: string, change: Override): void {
    overrides.set(key, { ...overrides.get(key), ...change });
  }

  function summary(on: IsoDate): PlanSummary | undefined {
    if (!plan || plan.abandoned) return undefined;
    const p = plan;
    const week = Math.min(p.weeks, Math.max(1, Math.floor(diffDays(p.startDate, on) / 7) + 1));
    const thisWeek = planWorkouts.filter((r) => r.weekIndex === week - 1).map(planItem);
    const measure: PlanSummary['measure'] =
      p.presetId === 'z2-base-8wk'
        ? {
            kind: 'z2_minutes',
            planned: Math.round(thisWeek.reduce((s, i) => s + i.estSeconds, 0) / 60 - thisWeek.length * 10),
            done: Math.round(thisWeek.filter((i) => i.status === 'done').reduce((s, i) => s + (i.details?.minutes ? i.details.minutes * 60 : i.estSeconds), 0) / 60 - thisWeek.filter((i) => i.status === 'done').length * 10),
          }
        : {
            kind: 'distance',
            plannedM: thisWeek.reduce((s, i) => s + (i.estMeters ?? 0), 0),
            doneM: thisWeek.filter((i) => i.status === 'done').reduce((s, i) => s + (i.details?.distanceM ?? i.estMeters ?? 0), 0),
          };
    return { id: p.id, presetId: p.presetId, name: p.name, startDate: p.startDate, endDate: p.endDate, weeks: p.weeks, inputs: p.inputs, currentWeek: week, measure };
  }

  return {
    agenda: agendaRaw,

    markDone(key, completedAt, details) {
      patch(key, { status: 'done', completedAt, details, skipReason: undefined });
    },
    skip(key, reason) {
      patch(key, { status: 'skipped', skipReason: reason, completedAt: undefined, details: undefined });
    },
    reopen(key) {
      patch(key, { status: 'pending', completedAt: undefined, details: undefined, skipReason: undefined });
    },
    move(key: string, toDate: IsoDate, scope: MoveScope) {
      const item = findItem(key);
      if (!item) throw new Error(`Unknown agenda item ${key}`);
      if (scope === 'schedule' && item.source.type === 'schedule') {
        const scheduleId = item.source.scheduleId;
        schedule = schedule.map((e) => (e.id === scheduleId ? { ...e, weekday: weekdayOf(toDate) } : e));
        return;
      }
      patch(key, { date: toDate === item.originalDate ? undefined : toDate });
    },
    swap(keyA, keyB) {
      const a = findItem(keyA);
      const b = findItem(keyB);
      if (!a || !b) throw new Error('Unknown agenda item');
      patch(keyA, { date: b.date === a.originalDate ? undefined : b.date });
      patch(keyB, { date: a.date === b.originalDate ? undefined : a.date });
    },

    addQuickLog(log) {
      const saved = { ...log, id: id('ql') };
      quickLogs.push(saved);
      return saved;
    },
    quickLogs(start, end) {
      return quickLogs.filter((l) => l.date >= start && l.date <= end);
    },

    currentHrProfile: () => hrProfile,
    saveHrProfile: setHr,

    activePlan: summary,
    createPlan(inputs, on) {
      const start = inputs.startDate ?? (inputs.raceDate ? addDays(startOfWeek(inputs.raceDate), -7 * 7) : startOfWeek(addDays(on, 7)));
      return startPlan(inputs, start);
    },
    abandonPlan(planId) {
      if (plan?.id === planId) plan = { ...plan, abandoned: true };
    },

    routines: () => routines,
    schedule: () => schedule,
    addScheduleEntry(entry) {
      const saved: ScheduleEntry = { ...entry, id: id('sc'), position: schedule.length };
      schedule = [...schedule, saved];
      return saved;
    },
    updateScheduleEntry(entryId, change) {
      schedule = schedule.map((e) => (e.id === entryId ? { ...e, ...change } : e));
    },
    removeScheduleEntry(entryId) {
      schedule = schedule.filter((e) => e.id !== entryId);
    },

    settings: () => settings,
    updateSettings(change) {
      settings = { ...settings, ...change };
    },
  };
}
