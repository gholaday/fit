/**
 * The run in progress. All workout logic comes from @fit/core (player, GPS filter, cues);
 * this module feeds it timestamps and fixes, persists progress every 5 s, and publishes
 * two stores: `useRun` for what changes rarely (phase, step) and `useLive` for the
 * once-a-second numbers, so only the small text nodes that show them re-render.
 *
 * Location fixes drive ticks when the screen is off (JS timers pause in the background);
 * the 1 s interval covers the foreground and Timer mode.
 */
import {
  type ActiveSession,
  type CueState,
  type DistanceSample,
  type GpsFilterState,
  type GpsFix,
  type PlayerState,
  type SessionMode,
  type Step,
  type TrackPoint,
  type WorkoutItem,
  activeMs,
  addFix,
  createPlayer,
  cuesFor,
  DEFAULT_CUE_PREFS,
  formatClock,
  formatDistance,
  initialCueState,
  initialGpsFilter,
  playerReducer,
  rollingPace,
  snapshot,
  trimSamples,
  zonePace,
} from '@fit/core';
import { create } from 'zustand';
import { repo } from '@/data';
import { actions, useFit } from '@/data/store';
import { cueHaptic, services } from './services';

export type RunPhase = 'ready' | 'countdown' | 'active' | 'paused' | 'finished';

export interface RunSetup {
  name: string;
  mode: SessionMode;
  items: readonly WorkoutItem[];
  workoutId?: string;
  /** Agenda key of the plan workout this run completes. */
  planWorkoutId?: string;
}

export interface RunView {
  phase: RunPhase;
  name: string;
  mode: SessionMode;
  steps: readonly Step[];
  stepIdx: number;
  sessionId?: string;
  /** Epoch ms when the 3-2-1 ends. */
  countdownEndsAt?: number;
  locked: boolean;
  voice: boolean;
  /** Saving completes a plan workout. */
  linked: boolean;
}

export interface Live {
  activeMs: number;
  stepElapsedMs: number;
  stepRemainingMs?: number;
  stepRemainingM?: number;
  stepProgress?: number;
  distanceM: number;
  /** Meters covered in the current step, for its average pace. */
  stepDistanceM: number;
  /** Rolling 20 s pace, sec/km. */
  paceSecPerKm?: number;
  /** Latest fix accuracy in meters, rejected fixes included (pre-start signal readout). */
  accuracyM?: number;
  lastFixAt?: number;
}

const COUNTDOWN_MS = 3000;
const COUNT_WORDS: Record<number, string> = { 3: 'Three', 2: 'Two', 1: 'One' };
const SAVE_EVERY_MS = 5000;

export const useRun = create<RunView>()(() => ({ phase: 'ready', name: '', mode: 'outdoor', steps: [], stepIdx: 0, locked: false, voice: true, linked: false }));
export const useLive = create<Live>()(() => ({ activeMs: 0, stepElapsedMs: 0, distanceM: 0, stepDistanceM: 0 }));

// Engine state. Plain module variables: none of it is rendered directly.
let player: PlayerState = createPlayer([]);
let gps: GpsFilterState = initialGpsFilter();
let samples: DistanceSample[] = [];
let pending: TrackPoint[] = [];
let cue: CueState = initialCueState();
let setup: RunSetup | undefined;
let lastSaveAt = 0;
let lastT = 0;
let ticker: ReturnType<typeof setInterval> | undefined;
let countdownTimer: ReturnType<typeof setTimeout> | undefined;
let vdot: number | undefined;

/** Target pace range of a pace step, sec/km, faster first. */
export function paceRangeFor(step: Step): { minSecPerKm: number; maxSecPerKm: number } | undefined {
  const t = step.target;
  if (t.type === 'pace_range') return t;
  if (t.type === 'pace_zone' && vdot !== undefined) return zonePace(vdot, t.zone);
  return undefined;
}

const unit = () => useFit.getState().settings.units.distance;

function resetEngine(s: RunSetup, p: PlayerState): void {
  setup = s;
  player = p;
  gps = initialGpsFilter();
  samples = [];
  pending = [];
  cue = initialCueState();
  lastSaveAt = 0;
  lastT = 0;
  vdot = repo.currentVdot();
}

/** Pre-start: load the workout, and for Outdoor start GPS so the signal readout warms up. */
export function prepareRun(s: RunSetup): void {
  stopTimers();
  resetEngine(s, createPlayer(s.items));
  useRun.setState({ phase: 'ready', name: s.name, mode: s.mode, steps: player.steps, stepIdx: 0, sessionId: undefined, countdownEndsAt: undefined, locked: false, linked: s.planWorkoutId !== undefined, voice: useFit.getState().settings.voice ?? true });
  useLive.setState({ activeMs: 0, stepElapsedMs: 0, distanceM: 0, stepDistanceM: 0, stepRemainingMs: undefined, stepRemainingM: undefined, stepProgress: undefined, paceSecPerKm: undefined });
  publish(Date.now());
  void setMode(s.mode);
}

/** Switching Outdoor/Timer on pre-start starts or stops the GPS warmup. */
export async function setMode(mode: SessionMode): Promise<void> {
  if (setup) setup = { ...setup, mode };
  useRun.setState({ mode });
  if (mode === 'outdoor') await services.location?.watch(onFix);
  else await services.location?.stop();
}

export function setVoice(voice: boolean): void {
  useRun.setState({ voice });
  actions.updateSettings({ voice });
  if (!voice) services.speaker?.stop();
}

export function setLocked(locked: boolean): void {
  useRun.setState({ locked });
}

export function startCountdown(): void {
  if (useRun.getState().phase !== 'ready') return;
  const endsAt = Date.now() + COUNTDOWN_MS;
  useRun.setState({ phase: 'countdown', countdownEndsAt: endsAt });
  countdownTimer = setTimeout(begin, COUNTDOWN_MS);
}

export function cancelCountdown(): void {
  if (countdownTimer) clearTimeout(countdownTimer);
  countdownTimer = undefined;
  useRun.setState({ phase: 'ready', countdownEndsAt: undefined });
}

function begin(): void {
  countdownTimer = undefined;
  if (!setup) return;
  const t = Date.now();
  player = playerReducer(player, { type: 'start', t });
  const sessionId = repo.startSession({
    name: setup.name,
    mode: setup.mode,
    startedAt: new Date(t).toISOString(),
    workoutId: setup.workoutId,
    planWorkoutId: setup.planWorkoutId,
    player,
  });
  lastSaveAt = t;
  useRun.setState({ phase: 'active', sessionId, countdownEndsAt: undefined });
  if (setup.mode === 'outdoor') void services.location?.record(onFix);
  startTicker();
  step(t);
}

/** Crash recovery: continue a session that was active when the app died. */
export function resumeRecovered(active: ActiveSession, items: readonly WorkoutItem[]): void {
  resetEngine({ name: active.name, mode: active.mode, items, workoutId: active.workoutId, planWorkoutId: active.planWorkoutId }, active.player);
  gps = { ...initialGpsFilter(), distanceM: active.distanceM };
  const phase: RunPhase = player.status === 'paused' ? 'paused' : 'active';
  useRun.setState({ phase, name: active.name, mode: active.mode, steps: player.steps, stepIdx: player.stepIdx, sessionId: active.id, locked: false, linked: active.planWorkoutId != null });
  if (active.mode === 'outdoor') void services.location?.record(onFix);
  startTicker();
  step(Date.now());
}

/**
 * Crash recovery: close a session that was active when the app died, ending it at the last
 * thing that was saved (the last track point, or the last step change for Timer runs).
 */
export function saveRecovered(active: ActiveSession): void {
  const p = active.player;
  const start = p.startedAt ?? Date.parse(active.startedAt);
  const lastOffset = Math.max(active.lastPoint?.tOffsetMs ?? 0, p.stepStartOffsetMs, p.log[p.log.length - 1]?.endOffsetMs ?? 0);
  const t = p.status === 'paused' && p.pausedAt !== undefined ? p.pausedAt : start + lastOffset;
  const done = playerReducer(p, { type: 'finish', t, distanceM: active.distanceM });
  repo.finishSession(active.id, {
    endedAt: new Date(t).toISOString(),
    player: done,
    distanceM: active.distanceM,
    elapsedMs: activeMs(done, t),
    pausedMs: done.pausedMs,
  });
  actions.reload();
}

function onFix(fix: GpsFix): void {
  useLive.setState({ accuracyM: fix.accuracy, lastFixAt: fix.t });
  const phase = useRun.getState().phase;
  // Fixes taken before Start (warmup fixes delivered late) are not part of the run.
  if ((phase !== 'active' && phase !== 'paused') || player.startedAt === undefined || fix.t < player.startedAt) return;
  const r = addFix(gps, fix, phase === 'active');
  if (r.verdict !== 'accepted') return;
  gps = r.state;
  pending.push({ tOffsetMs: fix.t - player.startedAt, lat: fix.lat, lng: fix.lng, alt: fix.alt, accuracy: fix.accuracy, speed: fix.speed });
  samples.push({ t: fix.t, distanceM: gps.distanceM });
  step(Date.now());
}

/** One engine step at wall time `t`: advance the player, fire cues, publish, persist. */
function step(tIn: number): void {
  const t = Math.max(tIn, lastT);
  lastT = t;
  const distanceM = gps.distanceM;
  const before = player.stepIdx;
  player = playerReducer(player, { type: 'tick', t, distanceM });
  samples = trimSamples(samples, t);
  const paceSecPerKm = rollingPace(samples, t);
  const snap = snapshot(player, t, distanceM);
  const r = cuesFor(cue, { snap, t, distanceM, currentPace: paceSecPerKm }, { unit: unit(), prefs: useFit.getState().settings.cues ?? DEFAULT_CUE_PREFS, paceRange: paceRangeFor });
  cue = r.state;
  for (const c of r.cues) {
    if (c.haptic) cueHaptic(c.haptic);
    // Countdown cues carry no text: the seconds are spoken, which ducks music like any cue.
    const text = c.kind === 'countdown' ? COUNT_WORDS[cue.countdownAt ?? 0] : c.text;
    if (text && useRun.getState().voice) services.speaker?.speak(text);
  }
  if (player.stepIdx !== before) useRun.setState({ stepIdx: player.stepIdx });
  publish(t, paceSecPerKm);
  if (player.status === 'finished') {
    void finishRun();
    return;
  }
  if (t - lastSaveAt >= SAVE_EVERY_MS) save(t);
}

function publish(t: number, paceSecPerKm?: number): void {
  const snap = snapshot(player, t, gps.distanceM);
  useLive.setState({
    activeMs: snap.activeMs,
    stepElapsedMs: snap.stepElapsedMs,
    stepRemainingMs: snap.stepRemainingMs,
    stepRemainingM: snap.stepRemainingM,
    stepProgress: snap.stepProgress,
    distanceM: gps.distanceM,
    stepDistanceM: gps.distanceM - player.stepStartDistanceM,
    paceSecPerKm,
  });
}

function save(t: number): void {
  const id = useRun.getState().sessionId;
  if (!id) return;
  const points = pending;
  pending = [];
  repo.saveProgress(id, { player, distanceM: gps.distanceM, points });
  lastSaveAt = t;
  const status = `${formatDistance(gps.distanceM, unit(), 2)}, ${formatClock(activeMs(player, t) / 1000)}`;
  services.location?.setStatus(status);
}

function startTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => step(Date.now()), 1000);
}

function stopTimers(): void {
  if (ticker) clearInterval(ticker);
  if (countdownTimer) clearTimeout(countdownTimer);
  ticker = undefined;
  countdownTimer = undefined;
}

export function pause(): void {
  const t = Date.now();
  player = playerReducer(player, { type: 'pause', t });
  useRun.setState({ phase: 'paused' });
  publish(t);
  save(t);
}

export function resume(): void {
  const t = Date.now();
  player = playerReducer(player, { type: 'resume', t });
  useRun.setState({ phase: 'active' });
  step(t);
}

export function skipStep(): void {
  const t = Date.now();
  player = playerReducer(player, { type: 'skip', t, distanceM: gps.distanceM });
  step(t);
}

export function lap(): void {
  const t = Date.now();
  player = playerReducer(player, { type: 'lap', t, distanceM: gps.distanceM });
  step(t);
}

/** End: close the player, store the session, mark the plan workout done. Returns the session id. */
export async function finishRun(): Promise<string | undefined> {
  const id = useRun.getState().sessionId;
  if (useRun.getState().phase === 'finished') return id;
  const t = Date.now();
  player = playerReducer(player, { type: 'finish', t, distanceM: gps.distanceM });
  stopTimers();
  useRun.setState({ phase: 'finished' });
  publish(t);
  if (id) {
    // Flush the last points with the progress write, then close the session.
    repo.saveProgress(id, { player, distanceM: gps.distanceM, points: pending });
    pending = [];
    repo.finishSession(id, {
      endedAt: new Date(t).toISOString(),
      player,
      distanceM: gps.distanceM,
      elapsedMs: activeMs(player, t),
      pausedMs: player.pausedMs,
    });
    actions.reload();
  }
  services.speaker?.stop();
  await services.location?.stop();
  return id;
}

/** Throw the run away (End, then Discard, or leaving pre-start). */
export async function discardRun(): Promise<void> {
  const id = useRun.getState().sessionId;
  stopTimers();
  if (id) repo.discardSession(id);
  useRun.setState({ phase: 'ready', sessionId: undefined });
  services.speaker?.stop();
  await services.location?.stop();
}
