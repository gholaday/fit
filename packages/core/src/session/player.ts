import type { Step, WorkoutItem } from '../workout';
import { flattenSteps } from '../workout';

/**
 * Workout player (spec §5 lifecycle). A pure reducer over timestamped events. Elapsed
 * time always comes from timestamps, never from counting ticks, so Doze or a throttled
 * JS thread can't drift the clock. The whole state is JSON, so the recorder persists it
 * every 5 s for crash recovery and resumes from it.
 */

export type PlayerStatus = 'ready' | 'active' | 'paused' | 'finished';

export interface StepLogEntry {
  idx: number;
  /** Active (pause-excluded) ms since start when the step began and ended. */
  startActiveMs: number;
  endActiveMs: number;
  /** Wall-clock offset from session start, for mapping onto track points in replay. */
  startOffsetMs: number;
  endOffsetMs: number;
  startDistanceM: number;
  endDistanceM: number;
  skipped: boolean;
}

export interface PlayerState {
  steps: Step[];
  status: PlayerStatus;
  /** Epoch ms of start. */
  startedAt?: number;
  pausedMs: number;
  pausedAt?: number;
  stepIdx: number;
  stepStartActiveMs: number;
  stepStartOffsetMs: number;
  stepStartDistanceM: number;
  log: StepLogEntry[];
  /** Wall-clock [start, end] offsets of every pause, for splits and replay gaps. */
  pauses: [number, number][];
}

export type PlayerEvent =
  | { type: 'start'; t: number }
  | { type: 'pause'; t: number }
  | { type: 'resume'; t: number }
  | { type: 'tick'; t: number; distanceM: number }
  | { type: 'skip'; t: number; distanceM: number }
  | { type: 'lap'; t: number; distanceM: number }
  | { type: 'finish'; t: number; distanceM: number }
  /** Stay longer: add seconds to the current time step (stretch +15 s). */
  | { type: 'extend'; t: number; seconds: number }
  /** Go to any step (previous, overview jump). The current step is logged as skipped. */
  | { type: 'jump'; t: number; distanceM: number; idx: number };

/** A free run is one open run step: no target, ends when you tap End. */
export const FREE_RUN_STEP: Step = { id: 'free', activity: 'run', duration: { type: 'open' }, target: { type: 'none' } };

export function createPlayer(items: readonly WorkoutItem[]): PlayerState {
  const steps = flattenSteps(items);
  return {
    steps: steps.length > 0 ? steps : [FREE_RUN_STEP],
    status: 'ready',
    pausedMs: 0,
    stepIdx: 0,
    stepStartActiveMs: 0,
    stepStartOffsetMs: 0,
    stepStartDistanceM: 0,
    log: [],
    pauses: [],
  };
}

/** Active (pause-excluded) ms at wall time `t`. */
export function activeMs(s: PlayerState, t: number): number {
  if (s.startedAt === undefined) return 0;
  const end = s.pausedAt ?? t;
  return Math.max(0, end - s.startedAt - s.pausedMs);
}

const offsetAt = (s: PlayerState, t: number) => (s.startedAt === undefined ? 0 : t - s.startedAt);

/** Close the current step and open the next (or finish). */
function advance(s: PlayerState, endActiveMs: number, endOffsetMs: number, distanceM: number, skipped: boolean): PlayerState {
  const entry: StepLogEntry = {
    idx: s.stepIdx,
    startActiveMs: s.stepStartActiveMs,
    endActiveMs,
    startOffsetMs: s.stepStartOffsetMs,
    endOffsetMs,
    startDistanceM: s.stepStartDistanceM,
    endDistanceM: distanceM,
    skipped,
  };
  const next = s.stepIdx + 1;
  const base = { ...s, log: [...s.log, entry] };
  if (next >= s.steps.length) return { ...base, status: 'finished', pausedAt: undefined };
  return { ...base, stepIdx: next, stepStartActiveMs: endActiveMs, stepStartOffsetMs: endOffsetMs, stepStartDistanceM: distanceM };
}

/**
 * Advance through every step that has completed by time `t`. Time steps end exactly
 * at their boundary (not at the tick), so a late tick never stretches a step. Several
 * steps can complete in one tick after the app was in the background.
 */
function autoAdvance(s: PlayerState, t: number, distanceM: number): PlayerState {
  let state = s;
  const nowActive = activeMs(state, t);
  for (let guard = 0; guard < state.steps.length && state.status === 'active'; guard++) {
    const step = state.steps[state.stepIdx]!;
    const d = step.duration;
    if (d.type === 'time') {
      const endActive = state.stepStartActiveMs + d.seconds * 1000;
      if (nowActive < endActive) break;
      // Wall offset of the boundary: the current offset minus the active time past it.
      const endOffset = offsetAt(state, t) - (nowActive - endActive);
      // Distance at the boundary isn't known exactly; attribute it all to the ending step.
      state = advance(state, endActive, endOffset, distanceM, false);
    } else if (d.type === 'distance') {
      if (distanceM - state.stepStartDistanceM < d.meters) break;
      state = advance(state, nowActive, offsetAt(state, t), distanceM, false);
    } else {
      break; // open and reps steps wait for Lap
    }
  }
  return state;
}

export function playerReducer(s: PlayerState, e: PlayerEvent): PlayerState {
  switch (e.type) {
    case 'start':
      return s.status === 'ready' ? { ...s, status: 'active', startedAt: e.t } : s;
    case 'pause':
      return s.status === 'active' ? { ...s, status: 'paused', pausedAt: e.t } : s;
    case 'resume':
      if (s.status !== 'paused' || s.pausedAt === undefined) return s;
      return {
        ...s,
        status: 'active',
        pausedMs: s.pausedMs + (e.t - s.pausedAt),
        pausedAt: undefined,
        pauses: [...s.pauses, [offsetAt(s, s.pausedAt), offsetAt(s, e.t)]],
      };
    case 'tick':
      return s.status === 'active' ? autoAdvance(s, e.t, e.distanceM) : s;
    case 'skip':
    case 'lap': {
      if (s.status !== 'active' && s.status !== 'paused') return s;
      const settled = s.status === 'active' ? autoAdvance(s, e.t, e.distanceM) : s;
      if (settled.status === 'finished') return settled;
      return advance(settled, activeMs(settled, e.t), offsetAt(settled, e.t), e.distanceM, e.type === 'skip');
    }
    case 'extend': {
      const step = s.steps[s.stepIdx];
      if (!step || step.duration.type !== 'time' || s.status === 'finished' || s.status === 'ready') return s;
      const steps = [...s.steps];
      steps[s.stepIdx] = { ...step, duration: { type: 'time', seconds: step.duration.seconds + e.seconds } };
      return { ...s, steps };
    }
    case 'jump': {
      if ((s.status !== 'active' && s.status !== 'paused') || e.idx < 0 || e.idx >= s.steps.length || e.idx === s.stepIdx) return s;
      const closed = advance(s, activeMs(s, e.t), offsetAt(s, e.t), e.distanceM, true);
      return { ...closed, status: s.status, stepIdx: e.idx };
    }
    case 'finish': {
      if (s.status === 'finished' || s.status === 'ready') return s;
      let state = s.status === 'active' ? autoAdvance(s, e.t, e.distanceM) : s;
      if (state.status === 'paused' && state.pausedAt !== undefined) {
        state = { ...state, pauses: [...state.pauses, [offsetAt(state, state.pausedAt), offsetAt(state, e.t)]] };
      }
      if (state.status === 'finished') return state;
      // The current step closes as completed (it was in progress); the rest never ran.
      state = advance(state, activeMs(state, e.t), offsetAt(state, e.t), e.distanceM, false);
      return { ...state, status: 'finished', pausedAt: undefined };
    }
  }
}

export interface PlayerSnapshot {
  status: PlayerStatus;
  stepIdx: number;
  stepCount: number;
  step: Step;
  next?: Step;
  activeMs: number;
  stepElapsedMs: number;
  /** Time steps: ms left in the step. */
  stepRemainingMs?: number;
  /** Distance steps: meters left in the step. */
  stepRemainingM?: number;
  /** 0..1 progress through the current step (time or distance), undefined for open steps. */
  stepProgress?: number;
}

export function snapshot(s: PlayerState, t: number, distanceM: number): PlayerSnapshot {
  const step = s.steps[Math.min(s.stepIdx, s.steps.length - 1)]!;
  const active = activeMs(s, t);
  const stepElapsedMs = active - s.stepStartActiveMs;
  const snap: PlayerSnapshot = {
    status: s.status,
    stepIdx: s.stepIdx,
    stepCount: s.steps.length,
    step,
    activeMs: active,
    stepElapsedMs,
  };
  const next = s.steps[s.stepIdx + 1];
  if (next) snap.next = next;
  if (step.duration.type === 'time') {
    const total = step.duration.seconds * 1000;
    snap.stepRemainingMs = Math.max(0, total - stepElapsedMs);
    snap.stepProgress = Math.min(1, stepElapsedMs / total);
  } else if (step.duration.type === 'distance') {
    const done = distanceM - s.stepStartDistanceM;
    snap.stepRemainingM = Math.max(0, step.duration.meters - done);
    snap.stepProgress = Math.min(1, done / step.duration.meters);
  }
  return snap;
}
