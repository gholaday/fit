import type { DistanceUnit } from '../units';
import { METERS_PER_MILE } from '../units';
import type { HrZone, Step } from '../workout';
import { isHardStep } from '../workout';
import type { PlayerSnapshot } from './player';
import { isRunWalkStep } from './runwalk';
import { durationWords, numberWords, splitText, stepChangeText } from './speech';

/**
 * Cue engine (spec §5 Audio & haptic cues). Called on every player tick with the new
 * snapshot; returns what to say and which haptic to play. Stateful only through the
 * returned CueState, so it's pure and testable with a fixed clock.
 */

/** 'zone' is the single soft chime for "Back in zone". */
export type Haptic = 'step' | 'countdown' | 'finish' | 'zone';

export interface Cue {
  kind: 'step_change' | 'countdown' | 'halfway' | 'split' | 'pace_nudge' | 'hr_high' | 'hr_low' | 'hr_back' | 'zone_update' | 'finish';
  /** Spoken text. Countdown beeps have none. */
  text?: string;
  haptic?: Haptic;
}

export interface CuePrefs {
  splits: 'every' | 'off';
  halfway: boolean;
  paceNudge: boolean;
  /** "Ease off" above the HR range and "Back in zone" after (spec §7 in-session cues). */
  hrAlerts: boolean;
  /** "You can pick it up a little" below the range. Off by default. */
  hrBelow: boolean;
  /** Every 5 minutes on HR steps: "Twenty minutes. Ninety-two percent in zone." Off by default. */
  zoneUpdates: boolean;
}

export const DEFAULT_CUE_PREFS: CuePrefs = { splits: 'every', halfway: true, paceNudge: true, hrAlerts: true, hrBelow: false, zoneUpdates: false };

export interface CueContext {
  unit: DistanceUnit;
  prefs: CuePrefs;
  /** Target pace range for a pace step, sec/km (faster first). */
  paceRange?: (step: Step) => { minSecPerKm: number; maxSecPerKm: number } | undefined;
  /** Treadmill nudges name the belt ("Raise the speed.") since pace follows the speed you set. */
  treadmill?: boolean;
  /** HR range for an HR step, with its zone when the target is a zone. */
  hrRange?: (step: Step) => { minBpm: number; maxBpm: number; zone?: HrZone } | undefined;
}

export interface CueInput {
  snap: PlayerSnapshot;
  t: number;
  distanceM: number;
  /** Rolling 20 s pace, sec/km. */
  currentPace?: number;
  /** Smoothed live HR (smoothedHr), when a sensor is connected. */
  hr?: number;
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
  /** HR outside the step's range since `since`. */
  hrOut?: { since: number; direction: 'high' | 'low' };
  lastHrCueAt?: number;
  /** An HR alert was spoken, so returning to range earns "Back in zone". */
  hrAlerted?: boolean;
  /** In-range and measured ms on this step, for zone updates. */
  zoneMs?: number;
  hrMs?: number;
  hrLastT?: number;
  zoneUpdatesDone?: number;
  finished: boolean;
}

export const initialCueState = (): CueState => ({ stepIdx: 0, halfwayDone: false, splitsDone: 0, lastSplitActiveMs: 0, finished: false });

export const NUDGE_AFTER_MS = 30_000;
export const NUDGE_EVERY_MS = 60_000;
export const HR_HIGH_AFTER_MS = 20_000;
export const HR_LOW_AFTER_MS = 60_000;
export const HR_CUE_EVERY_MS = 60_000;
export const ZONE_UPDATE_EVERY_MS = 5 * 60_000;
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
    s = {
      ...s,
      stepIdx: snap.stepIdx,
      halfwayDone: false,
      countdownAt: undefined,
      outOfRange: undefined,
      hrOut: undefined,
      hrAlerted: false,
      zoneMs: 0,
      hrMs: 0,
      hrLastT: undefined,
      zoneUpdatesDone: 0,
    };
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

  // HR cues with hysteresis. Run/walk steps answer a high HR with a walk break instead.
  const hrRange = ctx.hrRange?.(snap.step);
  if (hrRange && snap.status === 'active') {
    const zoneText = hrRange.zone ? `zone ${numberWords(hrRange.zone)}` : 'range';
    if (input.hr === undefined) s.hrLastT = undefined;
    else {
      const hr = input.hr;
      const direction = hr > hrRange.maxBpm ? 'high' : hr < hrRange.minBpm ? 'low' : undefined;
      // Time in range for zone updates; a gap over 5 s (dropout or background) is not counted.
      if (s.hrLastT !== undefined && t - s.hrLastT <= 5000) {
        s.hrMs = (s.hrMs ?? 0) + (t - s.hrLastT);
        if (!direction) s.zoneMs = (s.zoneMs ?? 0) + (t - s.hrLastT);
      }
      s.hrLastT = t;

      const canCue = s.lastHrCueAt === undefined || t - s.lastHrCueAt >= HR_CUE_EVERY_MS;
      if (!direction) {
        if (s.hrAlerted && ctx.prefs.hrAlerts) cues.push({ kind: 'hr_back', text: `Back in ${zoneText}.`, haptic: 'zone' });
        s = { ...s, hrOut: undefined, hrAlerted: false };
      } else if (!s.hrOut || s.hrOut.direction !== direction) s.hrOut = { since: t, direction };
      else if (direction === 'high' && ctx.prefs.hrAlerts && !isRunWalkStep(snap.step) && t - s.hrOut.since >= HR_HIGH_AFTER_MS && canCue) {
        cues.push({ kind: 'hr_high', text: `Heart rate ${numberWords(hr)}. Ease off.` });
        s = { ...s, lastHrCueAt: t, hrAlerted: true };
      } else if (direction === 'low' && ctx.prefs.hrBelow && t - s.hrOut.since >= HR_LOW_AFTER_MS && canCue) {
        cues.push({ kind: 'hr_low', text: 'You can pick it up a little.' });
        s = { ...s, lastHrCueAt: t, hrAlerted: true };
      }
    }

    const due = Math.floor(snap.stepElapsedMs / ZONE_UPDATE_EVERY_MS);
    if (ctx.prefs.zoneUpdates && due > (s.zoneUpdatesDone ?? 0) && (s.hrMs ?? 0) > 0) {
      const pct = Math.round(((s.zoneMs ?? 0) / s.hrMs!) * 100);
      const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
      cues.push({ kind: 'zone_update', text: `${cap(durationWords((due * ZONE_UPDATE_EVERY_MS) / 1000))}. ${cap(numberWords(pct))} percent in ${zoneText}.` });
      s.zoneUpdatesDone = due;
    }
  }

  return { state: s, cues };
}
