/**
 * GPS point handling (spec §5 Outdoor): filtering, light smoothing, distance and a
 * rolling pace window. Pure and incremental, so the recorder feeds one fix at a time.
 */

export interface GpsFix {
  /** Epoch ms of the fix. */
  t: number;
  lat: number;
  lng: number;
  alt?: number;
  /** Horizontal accuracy in meters. */
  accuracy: number;
  /** Device-reported speed, m/s. */
  speed?: number;
}

export interface TrackPoint {
  /** Offset from session start, ms. */
  tOffsetMs: number;
  lat: number;
  lng: number;
  alt?: number;
  accuracy: number;
  speed?: number;
}

export const MAX_ACCURACY_M = 25;
export const MAX_SPEED_MPS = 12;
/** Points in the smoothing window. */
const SMOOTH_WINDOW = 3;

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GpsFilterState {
  /** Last accepted raw fix, for jump detection. */
  lastRaw?: GpsFix;
  /** Recent accepted raw fixes for the moving average. */
  window: GpsFix[];
  /** Last smoothed position, for distance. */
  lastSmoothed?: { lat: number; lng: number };
  distanceM: number;
}

export const initialGpsFilter = (): GpsFilterState => ({ window: [], distanceM: 0 });

export type GpsVerdict = 'accepted' | 'inaccurate' | 'jump' | 'stale';

/**
 * Accept or reject one fix. Rejects accuracy over 25 m and jumps implying over 12 m/s,
 * then smooths with a short moving average and accumulates distance on the smoothed path.
 * `countDistance` is false while paused, so position keeps tracking without adding meters.
 */
export function addFix(
  state: GpsFilterState,
  fix: GpsFix,
  countDistance = true,
): { state: GpsFilterState; verdict: GpsVerdict; smoothed?: { lat: number; lng: number } } {
  if (fix.accuracy > MAX_ACCURACY_M) return { state, verdict: 'inaccurate' };
  const last = state.lastRaw;
  if (last) {
    const dt = (fix.t - last.t) / 1000;
    if (dt <= 0) return { state, verdict: 'stale' };
    if (haversineM(last, fix) / dt > MAX_SPEED_MPS) return { state, verdict: 'jump' };
  }
  const window = [...state.window, fix].slice(-SMOOTH_WINDOW);
  const smoothed = {
    lat: window.reduce((s, p) => s + p.lat, 0) / window.length,
    lng: window.reduce((s, p) => s + p.lng, 0) / window.length,
  };
  const step = state.lastSmoothed && countDistance ? haversineM(state.lastSmoothed, smoothed) : 0;
  return {
    state: { lastRaw: fix, window, lastSmoothed: smoothed, distanceM: state.distanceM + step },
    verdict: 'accepted',
    smoothed,
  };
}

/** Distance samples for the rolling pace window. */
export interface DistanceSample {
  t: number;
  distanceM: number;
}

export const PACE_WINDOW_MS = 20_000;

/**
 * Current pace over the last 20 s, sec/km. Undefined until the window has enough
 * movement (at least 10 m), so the display shows a dash instead of a wild number.
 */
export function rollingPace(samples: readonly DistanceSample[], now: number, windowMs = PACE_WINDOW_MS): number | undefined {
  const inWindow = samples.filter((s) => s.t >= now - windowMs && s.t <= now);
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  if (!first || !last || last.t <= first.t) return undefined;
  const meters = last.distanceM - first.distanceM;
  if (meters < 10) return undefined;
  return ((last.t - first.t) / 1000 / meters) * 1000;
}

/** Keep only what the pace window needs. */
export function trimSamples(samples: DistanceSample[], now: number, windowMs = PACE_WINDOW_MS): DistanceSample[] {
  const cutoff = now - windowMs - 1000;
  const i = samples.findIndex((s) => s.t >= cutoff);
  return i <= 0 ? samples : samples.slice(i);
}

// ---------------------------------------------------------------------------
// Auto-pause (spec §5): speed < 0.6 m/s for 6 s pauses; > 1.0 m/s resumes.

export const AUTO_PAUSE_BELOW_MPS = 0.6;
export const AUTO_RESUME_ABOVE_MPS = 1.0;
export const AUTO_PAUSE_AFTER_MS = 6000;

export interface AutoPauseState {
  paused: boolean;
  /** When speed first dropped below the pause threshold. */
  slowSince?: number;
}

export function autoPause(state: AutoPauseState, speedMps: number, t: number): AutoPauseState {
  if (state.paused) return speedMps > AUTO_RESUME_ABOVE_MPS ? { paused: false } : state;
  if (speedMps >= AUTO_PAUSE_BELOW_MPS) return { paused: false };
  const slowSince = state.slowSince ?? t;
  return t - slowSince >= AUTO_PAUSE_AFTER_MS ? { paused: true } : { paused: false, slowSince };
}
