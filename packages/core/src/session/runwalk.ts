import type { Step } from '../workout';
import { activeMs, type PlayerState, type RunWalkPhase, type RunWalkSegment } from './player';

/**
 * HR-driven run/walk (spec §7 Z2 Run/Walk): run until HR reaches the cap, walk until it
 * drops RUN_WALK_DROP_BPM below, repeat. Pure; the recorder calls runWalkPhase on each
 * tick with smoothed HR and dispatches a 'phase' event when it returns one.
 */

export const RUN_WALK_DROP_BPM = 10;
/** Shortest phase before switching again, so HR hovering at the cap does not flap. */
export const RUN_WALK_MIN_PHASE_MS = 20_000;

/** Steps with `hrGuard.walkWhenAbove` switch between running and walking on their own. */
export const isRunWalkStep = (step: Step) => step.hrGuard?.walkWhenAbove === true;

/** The cap: the guard's bpm, else the top of the step's HR range. */
export const hrCap = (step: Step, range?: { maxBpm: number }) => step.hrGuard?.capBpm ?? range?.maxBpm;

/**
 * The phase to switch to now, or undefined to stay. A run/walk step starts in the run
 * phase; without HR (a dropout) it keeps the current phase.
 */
export function runWalkPhase(s: PlayerState, t: number, hr: number | undefined, capBpm: number | undefined): RunWalkPhase | undefined {
  const step = s.steps[s.stepIdx];
  if (s.status !== 'active' || !step || !isRunWalkStep(step) || capBpm === undefined) return undefined;
  const open = s.runWalk?.open;
  if (!open || open.stepIdx !== s.stepIdx) return 'run';
  if (hr === undefined || activeMs(s, t) - open.startActiveMs < RUN_WALK_MIN_PHASE_MS) return undefined;
  if (open.phase === 'run' && hr >= capBpm) return 'walk';
  if (open.phase === 'walk' && hr <= capBpm - RUN_WALK_DROP_BPM) return 'run';
  return undefined;
}

/** Spoken on a switch. The first run phase of a step is silent (the step change already spoke). */
export const runWalkCueText = (phase: RunWalkPhase) => (phase === 'walk' ? 'Take a walk break.' : 'Run again.');

/** Run and walk seconds and meters across segments, for the summary and the ratio trend. */
export function runWalkTotals(segments: readonly RunWalkSegment[]): { runS: number; walkS: number; runM: number; walkM: number } {
  const out = { runS: 0, walkS: 0, runM: 0, walkM: 0 };
  for (const g of segments) {
    const s = (g.endActiveMs - g.startActiveMs) / 1000;
    const m = Math.max(0, g.endDistanceM - g.startDistanceM);
    if (g.phase === 'run') {
      out.runS += s;
      out.runM += m;
    } else {
      out.walkS += s;
      out.walkM += m;
    }
  }
  return { runS: Math.round(out.runS), walkS: Math.round(out.walkS), runM: Math.round(out.runM), walkM: Math.round(out.walkM) };
}
