import type { Step } from './workout';

/**
 * Strength and stretch routines (spec §9, §10). Routines are what the weekly schedule
 * points at; their items reference exercises by our catalog id, so renames and
 * re-imports never break history.
 */

export const ROUTINE_ITEMS_SCHEMA_VERSION = 2;

export interface StrengthItem {
  exerciseId: string;
  sets: number;
  reps: number;
  /** Target weight; omitted for bodyweight or "use last time". */
  weightKg?: number;
  restS: number;
}

export interface StretchItem {
  exerciseId: string;
  /** Hold per side, seconds. */
  holdS: number;
  sides: 'both' | 'none';
  /** Dynamic moves (circles) count reps instead of holding; the player still times them. */
  reps?: number;
}

export type RoutineItems =
  | { schemaVersion: 2; kind: 'strength'; restS: number; items: StrengthItem[] }
  | { schemaVersion: 2; kind: 'stretch'; transitionS: number; items: StretchItem[] };

/** Gap between left and right on two-sided stretches (spec §10). */
export const SWITCH_SIDES_S = 5;
/** Rough time to perform one strength set, used only for the card estimate. */
const SET_WORK_S = 40;

/**
 * Card estimate. Stretch: holds x sides, plus side switches, plus transitions
 * between moves. Strength: sets x (work + rest), without rest after the last set.
 */
export function routineSeconds(r: RoutineItems): number {
  if (r.kind === 'stretch') {
    const moves = r.items.reduce((sum, i) => sum + (i.sides === 'both' ? 2 * i.holdS + SWITCH_SIDES_S : i.holdS), 0);
    return moves + Math.max(0, r.items.length - 1) * r.transitionS;
  }
  const sets = r.items.reduce((n, i) => n + i.sets, 0);
  const rest = r.items.reduce((sum, i) => sum + i.sets * i.restS, 0);
  const lastRest = r.items.at(-1)?.restS ?? 0;
  return sets * SET_WORK_S + rest - lastRest;
}

/**
 * The guided stretch player as workout steps, so it runs on the same timestamp-driven
 * player as runs. Two-sided moves expand to Left, "Switch sides", Right; a transition
 * step ("Next: Pigeon") sits between moves, never after the last. `itemIdx` on each
 * step's id lets the overview jump to a move.
 */
export function stretchSteps(r: Extract<RoutineItems, { kind: 'stretch' }>): Step[] {
  const steps: Step[] = [];
  r.items.forEach((item, idx) => {
    const target = { type: 'stretch' as const, stretchId: item.exerciseId, sides: item.sides, ...(item.reps ? { reps: item.reps } : {}) };
    const hold = (label: string | undefined, side: string): Step => ({
      id: `${idx}:${side}`,
      activity: 'stretch',
      duration: { type: 'time', seconds: item.holdS },
      target,
      ...(label ? { label } : {}),
    });
    if (item.sides === 'both') {
      steps.push(hold('Left', 'left'));
      steps.push({ id: `${idx}:switch`, label: 'Switch sides', activity: 'rest', duration: { type: 'time', seconds: SWITCH_SIDES_S }, target: { type: 'none' } });
      steps.push(hold('Right', 'right'));
    } else {
      steps.push(hold(undefined, 'hold'));
    }
    if (idx < r.items.length - 1 && r.transitionS > 0) {
      steps.push({ id: `${idx}:next`, label: 'Next', activity: 'rest', duration: { type: 'time', seconds: r.transitionS }, target: { type: 'none' } });
    }
  });
  return steps;
}

/** Index of the first step of move `itemIdx`, for previous and jump-to-move. */
export function firstStepOfItem(steps: readonly Step[], itemIdx: number): number {
  return steps.findIndex((s) => s.id.startsWith(`${itemIdx}:`) && !s.id.endsWith(':next'));
}

// ---------------------------------------------------------------------------
// Strength logging

export interface LoggedSet {
  exerciseId: string;
  setIdx: number;
  reps: number;
  weightKg?: number;
  durationS?: number;
}

export interface SetRow {
  setIdx: number;
  /** Prefilled from last time when available, else the routine target. */
  reps: number;
  weightKg?: number;
  /** Last time's values, shown greyed beside the row. */
  previous?: { reps: number; weightKg?: number };
}

/**
 * Set rows for an exercise, prefilled from the last session (spec §9 Logging). Rows
 * follow the routine's set count; extra sets from last time are dropped, missing ones
 * repeat the last logged set.
 */
export function prefillSets(item: StrengthItem, lastTime: readonly LoggedSet[]): SetRow[] {
  const prev = [...lastTime].filter((s) => s.exerciseId === item.exerciseId).sort((a, b) => a.setIdx - b.setIdx);
  return Array.from({ length: item.sets }, (_, setIdx) => {
    const p = prev[setIdx] ?? prev.at(-1);
    const row: SetRow = { setIdx, reps: p?.reps ?? item.reps };
    const weight = p?.weightKg ?? item.weightKg;
    if (weight !== undefined) row.weightKg = weight;
    const exact = prev[setIdx];
    if (exact) row.previous = exact.weightKg !== undefined ? { reps: exact.reps, weightKg: exact.weightKg } : { reps: exact.reps };
    return row;
  });
}

/** Total volume, kg (reps x weight over weighted sets). */
export function volumeKg(sets: readonly LoggedSet[]): number {
  return sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0);
}

/**
 * After finishing, "Update routine with these values?" (spec §9): the routine items
 * with sets, reps and weight taken from what was logged. Undefined when nothing changed.
 */
export function routineFromLog(r: Extract<RoutineItems, { kind: 'strength' }>, logged: readonly LoggedSet[]): RoutineItems | undefined {
  let changed = false;
  const items = r.items.map((item) => {
    const sets = logged.filter((s) => s.exerciseId === item.exerciseId);
    if (sets.length === 0) return item;
    const top = sets.reduce((best, s) => ((s.weightKg ?? 0) > (best.weightKg ?? 0) ? s : best), sets[0]!);
    const next: StrengthItem = { ...item, sets: sets.length, reps: top.reps };
    if (top.weightKg !== undefined) next.weightKg = top.weightKg;
    if (next.sets !== item.sets || next.reps !== item.reps || next.weightKg !== item.weightKg) changed = true;
    return next;
  });
  return changed ? { ...r, items } : undefined;
}
