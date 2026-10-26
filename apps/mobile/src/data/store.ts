/**
 * App state over FitRepository. Reads are synchronous, so the store is filled before the
 * first frame and screens never show a loading state. Writes are optimistic: the state
 * changes first, the repository write runs right after the frame, then the window is
 * re-read and merged with structural sharing so untouched rows keep their identity and
 * do not re-render.
 */
import {
  type AgendaItem,
  type CompletionDetails,
  type ExternalSession,
  type HrProfile,
  type HrProfileInput,
  type IsoDate,
  type MoveScope,
  type PlanInputs,
  type PlanSummary,
  type QuickLog,
  type Routine,
  type ScheduleEntry,
  type SessionListItem,
  type Settings,
  type SkipReason,
  type WorkoutSummary,
  addDays,
  localIsoDate,
  startOfWeek,
} from '@fit/core';
import { create } from 'zustand';
import { repo } from './index';

export interface Snack {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** A second line, used for the back-to-back note. */
  note?: string;
  noteActionLabel?: string;
  onNoteAction?: () => void;
}

export interface FitState {
  today: IsoDate;
  windowStart: IsoDate;
  windowEnd: IsoDate;
  items: Readonly<Record<string, AgendaItem>>;
  byDate: Readonly<Record<IsoDate, readonly string[]>>;
  plan: PlanSummary | undefined;
  settings: Settings;
  hrProfile: HrProfile | undefined;
  routines: readonly Routine[];
  schedule: readonly ScheduleEntry[];
  weekLogs: readonly QuickLog[];
  /** Latest recorded sessions, newest first; Today lists the ones no plan item claims. */
  recentRuns: readonly SessionListItem[];
  /** Run workouts in the library, most recently edited first. */
  workouts: readonly WorkoutSummary[];
  /** Saved watch activities that started today. */
  todayExternal: readonly ExternalSession[];
  /**
   * Bumped on every read. Rows keep their identity across reloads, so screens that query the
   * repository directly (exercise search) depend on this to see edits made elsewhere.
   */
  version: number;
  snack: Snack | undefined;
}

const EMPTY: readonly string[] = [];

/**
 * `next`, reusing `prev` and its unchanged parts wherever they are deep-equal, so a re-read
 * keeps the references selectors compare and untouched subscribers do not re-render.
 */
function share<T>(prev: T | undefined, next: T): T {
  if (prev === next || prev === undefined) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    const out = next.map((v, i) => share(prev[i], v));
    return (out.length === prev.length && out.every((v, i) => v === prev[i]) ? prev : out) as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    // Like JSON equality, a key set to undefined (optimistic patches) equals a missing key.
    const out: Record<string, unknown> = {};
    let same = definedKeys(prev) === definedKeys(next);
    for (const k of Object.keys(next)) {
      out[k] = share(prev[k], next[k]);
      if (out[k] !== prev[k]) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

function definedKeys(o: Record<string, unknown>): number {
  let n = 0;
  for (const k in o) if (o[k] !== undefined) n++;
  return n;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

function sameKeys(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function initialWindow(today: IsoDate): { windowStart: IsoDate; windowEnd: IsoDate } {
  const monday = startOfWeek(today);
  return { windowStart: addDays(monday, -7), windowEnd: addDays(monday, 20) };
}

/** Reads everything from the repository and merges it into `prev` with structural sharing. */
function read(today: IsoDate, windowStart: IsoDate, windowEnd: IsoDate, prev?: FitState): Omit<FitState, 'snack'> {
  const list = repo.agenda(windowStart, windowEnd);
  const items: Record<string, AgendaItem> = {};
  const dayKeys: Record<IsoDate, string[]> = {};
  for (const item of list) {
    items[item.key] = share(prev?.items[item.key], item);
    (dayKeys[item.date] ??= []).push(item.key);
  }
  const byDate: Record<IsoDate, readonly string[]> = {};
  for (const [date, keys] of Object.entries(dayKeys)) {
    const old = prev?.byDate[date];
    byDate[date] = sameKeys(old, keys) ? old! : keys;
  }
  const monday = startOfWeek(today);
  const plan = repo.activePlan(today);
  const schedule = repo.schedule();
  const runs = repo.recentSessions(20);
  const external = repo.externalSessions(today, today);
  const workouts = repo.workoutLibrary();
  return {
    today,
    windowStart,
    windowEnd,
    items,
    byDate,
    plan: share(prev?.plan, plan),
    settings: share(prev?.settings, repo.settings()),
    hrProfile: share(prev?.hrProfile, repo.currentHrProfile()),
    routines: share(prev?.routines, repo.routines()),
    schedule: share(prev?.schedule, schedule),
    weekLogs: share(prev?.weekLogs, repo.quickLogs(monday, addDays(monday, 6))),
    recentRuns: share(prev?.recentRuns, runs),
    workouts: share(prev?.workouts, workouts),
    todayExternal: share(prev?.todayExternal, external),
    version: (prev?.version ?? 0) + 1,
  };
}

const firstToday = localIsoDate(new Date());
const firstWindow = initialWindow(firstToday);

export const useFit = create<FitState>()(() => ({
  ...read(firstToday, firstWindow.windowStart, firstWindow.windowEnd),
  snack: undefined,
}));

// ---------- selectors (narrow, stable references) ----------

export const useDayKeys = (date: IsoDate) => useFit((s) => s.byDate[date] ?? EMPTY);
export const useItem = (key: string) => useFit((s) => s.items[key]);
export const useToday = () => useFit((s) => s.today);
export const usePlan = () => useFit((s) => s.plan);
export const useSettings = () => useFit((s) => s.settings);
export const useUnits = () => useFit((s) => s.settings.units);
export const useRoutines = () => useFit((s) => s.routines);
export const useSchedule = () => useFit((s) => s.schedule);
export const useHrProfile = () => useFit((s) => s.hrProfile);
export const useSnack = () => useFit((s) => s.snack);
export const useRecentRuns = () => useFit((s) => s.recentRuns);
export const useWeekLogs = () => useFit((s) => s.weekLogs);
export const useTodayExternal = () => useFit((s) => s.todayExternal);
export const useWorkouts = () => useFit((s) => s.workouts);
export const useDataVersion = () => useFit((s) => s.version);

export function getItems(start: IsoDate, end: IsoDate): AgendaItem[] {
  const s = useFit.getState();
  const out: AgendaItem[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) for (const k of s.byDate[d] ?? EMPTY) out.push(s.items[k]!);
  return out;
}

// ---------- writes ----------

function reload(): void {
  const s = useFit.getState();
  useFit.setState(read(s.today, s.windowStart, s.windowEnd, s));
}

/** UI first, storage right after the frame, then reconcile. */
function optimistic(apply: (s: FitState) => Partial<FitState>, write: () => void): void {
  useFit.setState(apply);
  setTimeout(() => {
    write();
    reload();
  }, 0);
}

function patchItems(s: FitState, changes: Record<string, Partial<AgendaItem>>): Partial<FitState> {
  const items = { ...s.items };
  let byDate: Record<IsoDate, readonly string[]> | undefined;
  for (const [key, change] of Object.entries(changes)) {
    const old = items[key];
    if (!old) continue;
    const next = { ...old, ...change };
    items[key] = next;
    if (change.date && change.date !== old.date) {
      byDate ??= { ...s.byDate };
      byDate[old.date] = (byDate[old.date] ?? EMPTY).filter((k) => k !== key);
      byDate[change.date] = [...(byDate[change.date] ?? EMPTY), key];
    }
  }
  return byDate ? { items, byDate } : { items };
}

let snackSeq = 0;

export function showSnack(snack: Omit<Snack, 'id'>): void {
  snackSeq += 1;
  useFit.setState({ snack: { ...snack, id: snackSeq } });
}

export function dismissSnack(id?: number): void {
  const s = useFit.getState();
  if (!s.snack || (id !== undefined && s.snack.id !== id)) return;
  useFit.setState({ snack: undefined });
}

export const actions = {
  /** Recompute "today" (app resume, midnight). */
  /** Re-read after a write made outside these actions (a recorded run finishing). */
  reload,

  refreshToday(): void {
    const today = localIsoDate(new Date());
    const s = useFit.getState();
    if (today === s.today) return;
    const w = initialWindow(today);
    useFit.setState(read(today, w.windowStart < s.windowStart ? w.windowStart : s.windowStart, w.windowEnd > s.windowEnd ? w.windowEnd : s.windowEnd, s));
  },

  /** Make sure a range is loaded (Plan week navigator). */
  ensureRange(start: IsoDate, end: IsoDate): void {
    const s = useFit.getState();
    if (start >= s.windowStart && end <= s.windowEnd) return;
    useFit.setState(read(s.today, start < s.windowStart ? start : s.windowStart, end > s.windowEnd ? end : s.windowEnd, s));
  },

  markDone(key: string, details?: CompletionDetails): void {
    const completedAt = new Date().toISOString();
    optimistic(
      (s) => patchItems(s, { [key]: { status: 'done', completedAt, details, skipReason: undefined } }),
      () => repo.markDone(key, completedAt, details),
    );
  },

  skip(key: string, reason?: SkipReason): void {
    optimistic(
      (s) => patchItems(s, { [key]: { status: 'skipped', skipReason: reason, completedAt: undefined, details: undefined } }),
      () => repo.skip(key, reason),
    );
  },

  reopen(key: string): void {
    optimistic(
      (s) => patchItems(s, { [key]: { status: 'pending', completedAt: undefined, details: undefined, skipReason: undefined } }),
      () => repo.reopen(key),
    );
  },

  /**
   * Move one item. Scope "schedule" changes the weekly schedule too, so the optimistic
   * patch only moves this occurrence and the reconcile pass brings in the rest.
   */
  move(key: string, toDate: IsoDate, scope: MoveScope = 'once'): void {
    optimistic(
      (s) => patchItems(s, { [key]: { date: toDate } }),
      () => repo.move(key, toDate, scope),
    );
  },

  swap(keyA: string, keyB: string): void {
    const s = useFit.getState();
    const a = s.items[keyA];
    const b = s.items[keyB];
    if (!a || !b) return;
    optimistic(
      (st) => patchItems(st, { [keyA]: { date: b.date }, [keyB]: { date: a.date } }),
      () => repo.swap(keyA, keyB),
    );
  },

  addQuickLog(log: Omit<QuickLog, 'id'>): void {
    optimistic(
      (s) => ({ weekLogs: [...s.weekLogs, { ...log, id: `pending_${Date.now()}` }] }),
      () => {
        repo.addQuickLog(log);
      },
    );
  },

  updateSettings(change: Partial<Settings>): void {
    optimistic(
      (s) => ({ settings: { ...s.settings, ...change } }),
      () => repo.updateSettings(change),
    );
  },

  /** Synchronous: setup needs the computed zones right away. */
  saveHrProfile(input: HrProfileInput): HrProfile {
    const profile = repo.saveHrProfile(input);
    reload();
    return profile;
  },

  createPlan(inputs: PlanInputs): PlanSummary {
    // Throws for invalid inputs; the repo abandons the current plan in the same transaction.
    const plan = repo.createPlan(inputs, useFit.getState().today);
    reload();
    return plan;
  },

  abandonPlan(): void {
    const plan = useFit.getState().plan;
    if (!plan) return;
    optimistic(
      () => ({ plan: undefined }),
      () => repo.abandonPlan(plan.id),
    );
  },

  addScheduleEntry(entry: Omit<ScheduleEntry, 'id' | 'position'>): void {
    optimistic(
      (s) => ({ schedule: [...s.schedule, { ...entry, id: `pending_${Date.now()}`, position: s.schedule.length }] }),
      () => {
        repo.addScheduleEntry(entry);
      },
    );
  },

  updateScheduleEntry(id: string, change: Partial<Omit<ScheduleEntry, 'id'>>): void {
    optimistic(
      (s) => ({ schedule: s.schedule.map((e) => (e.id === id ? { ...e, ...change } : e)) }),
      () => repo.updateScheduleEntry(id, change),
    );
  },

  removeScheduleEntry(id: string): void {
    optimistic(
      (s) => ({ schedule: s.schedule.filter((e) => e.id !== id) }),
      () => repo.removeScheduleEntry(id),
    );
  },
};

