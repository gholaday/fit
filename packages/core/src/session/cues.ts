import type { DistanceUnit } from '../units';
import { METERS_PER_MILE } from '../units';
import type { Step } from '../workout';
import { isHardStep } from '../workout';
import type { PlayerSnapshot } from './player';
import { splitText, stepChangeText } from './speech';

/**
 * Cue engine (spec §5 Audio & haptic cues). Called on every player tick with the new
 * snapshot; returns what to say and which haptic to play. Stateful only through the
 * returned CueState, so it's pure and testable with a fixed clock.
 */

export type Haptic = 'step' | 'countdown' | 'finish';

export interface Cue {
  kind: 'step_change' | 'countdown' | 'halfway' | 'split' | 'pace_nudge' | 'finish';
  /** Spoken text. Countdown beeps have none. */
  text?: string;
  haptic?: Haptic;
}

export interface CuePrefs {
  splits: 'every' | 'off';
  halfway: boolean;
  paceNudge: boolean;
}

export const DEFAULT_CUE_PREFS: CuePrefs = { splits: 'every', halfway: true, paceNudge: true };

export interface CueContext {
  unit: DistanceUnit;
  prefs: CuePrefs;
  /** Target pace range for a pace step, sec/km (faster first). */
  paceRange?: (step: Step) => { minSecPerKm: number; maxSecPerKm: number } | undefined;
  /** Treadmill nudges name the belt ("Raise the speed.") since pace follows the speed you set. */
  treadmill?: boolean;
}

export interface CueInput {
  snap: PlayerSnapshot;
  t: number;
  distanceM: number;
  /** Rolling 20 s pace, sec/km. */
  currentPace?: number;
}

export interface CueState {
  stepIdx: number;
  halfwayDone: boolean;
  /** Last whole countdown second announced (3, 2, 1). */
  countdownAt?: number;
  splitsDone: number;
  lastSplitActiveMs: number;
  outOfRange?: { since: number; direction: 'slow' | 'fast' };
  lastNudgeAt?: number;
  finished: boolean;
}

export const initialCueState = (): CueState => ({ stepIdx: 0, halfwayDone: false, splitsDone: 0, lastSplitActiveMs: 0, finished: false });

export const NUDGE_AFTER_MS = 30_000;
export const NUDGE_EVERY_MS = 60_000;
const HALFWAY_MIN_MS = 3 * 60_000;

export function cuesFor(state: CueState, input: CueInput, ctx: CueContext): { state: CueState; cues: Cue[] } {
  const { snap, t, distanceM } = input;
  const cues: Cue[] = [];
  let s = { ...state };

  if (snap.status === 'finished') {
    if (!s.finished) cues.push({ kind: 'finish', text: 'Workout complete.', haptic: 'finish' });
    return { state: { ...s, finished: true }, cues };
  }

  // Step change: always announced.
  if (snap.stepIdx !== s.stepIdx) {
    cues.push({ kind: 'step_change', text: stepChangeText(snap.step, ctx.unit), haptic: 'step' });
    s = { ...s, stepIdx: snap.stepIdx, halfwayDone: false, countdownAt: undefined, outOfRange: undefined };
  }

  // Countdown beeps in the last 3 s of hard time steps.
  if (snap.stepRemainingMs !== undefined && isHardStep(snap.step)) {
    const sec = Math.ceil(snap.stepRemainingMs / 1000);
    if (sec >= 1 && sec <= 3 && s.countdownAt !== sec) {
      cues.push({ kind: 'countdown', haptic: 'countdown' });
      s.countdownAt = sec;
    }
  }

  // Halfway on steps of 3 min or more.
  const d = snap.step.duration;
  if (ctx.prefs.halfway && !s.halfwayDone && d.type === 'time' && d.seconds * 1000 >= HALFWAY_MIN_MS && snap.stepElapsedMs >= (d.seconds * 1000) / 2) {
    cues.push({ kind: 'halfway', text: 'Halfway.' });
    s.halfwayDone = true;
  }

  // Splits every mile or kilometer.
  const unitM = ctx.unit === 'mi' ? METERS_PER_MILE : 1000;
  const whole = Math.floor(distanceM / unitM);
  if (whole > s.splitsDone) {
    if (ctx.prefs.splits === 'every' && distanceM > 0) {
      const splitPace = (snap.activeMs - s.lastSplitActiveMs) / 1000 / ((whole - s.splitsDone) * unitM / 1000);
      const avgPace = snap.activeMs / 1000 / (distanceM / 1000);
      cues.push({ kind: 'split', text: splitText(whole, splitPace, avgPace, ctx.unit) });
    }
    s = { ...s, splitsDone: whole, lastSplitActiveMs: snap.activeMs };
  }

  // Pace nudge: outside the target range for 30 s, at most once a minute.
  const range = ctx.prefs.paceNudge && snap.step.activity !== 'sprint' ? ctx.paceRange?.(snap.step) : undefined;
  if (range && input.currentPace !== undefined) {
    const direction = input.currentPace > range.maxSecPerKm ? 'slow' : input.currentPace < range.minSecPerKm ? 'fast' : undefined;
    if (!direction) s.outOfRange = undefined;
    else if (!s.outOfRange || s.outOfRange.direction !== direction) s.outOfRange = { since: t, direction };
    else if (t - s.outOfRange.since >= NUDGE_AFTER_MS && (s.lastNudgeAt === undefined || t - s.lastNudgeAt >= NUDGE_EVERY_MS)) {
      cues.push({ kind: 'pace_nudge', text: ctx.treadmill ? (direction === 'slow' ? 'Raise the speed.' : 'Lower the speed.') : direction === 'slow' ? 'A little faster.' : 'Ease off.' });
      s.lastNudgeAt = t;
    }
  }

  return { state: s, cues };
}
