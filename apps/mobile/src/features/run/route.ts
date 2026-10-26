/**
 * Map geometry for the summary map and replay, built once per session. The route is one
 * line with `lineMetrics`, colored by step through a `line-gradient` over `line-progress`
 * (distance along the line), so step colors and the replay trail are one paint change and
 * never a new source.
 */
import { cumulativeDistance, type DistancePoint, type DistanceUnit, METERS_PER_MILE, positionAt, type SessionDetail, simplifyTo, stepAtOffset, type TrackPoint } from '@fit/core';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { type Palette, toneColor } from '@/theme';
import { stepTone } from './steps';

export const MAP_STYLE = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
/** Glyphs served by the OpenFreeMap styles. */
export const MAP_FONT = ['Noto Sans Bold'];

export interface ColorStop {
  /** 0..1 along the drawn line. */
  at: number;
  color: string;
}

export interface RouteGeometry {
  line: Feature<LineString>;
  start: Feature<Point>;
  finish: Feature<Point>;
  markers: FeatureCollection<Point, { label: string }>;
  /** [west, south, east, north]. */
  bounds: [number, number, number, number];
  /** Step colors by distance fraction, first stop at 0. */
  stops: ColorStop[];
  /** Simplified points with their cumulative distance, for mapping a time to a line fraction. */
  drawn: readonly TrackPoint[];
  drawnDist: readonly DistancePoint[];
  /** Full-resolution distance, for readouts. */
  dist: readonly DistancePoint[];
}

const point = (lng: number, lat: number): Feature<Point> => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } });

export function buildRoute(session: SessionDetail, p: Palette, unit: DistanceUnit): RouteGeometry {
  const drawn = simplifyTo(session.points, 1500);
  const drawnDist = cumulativeDistance(drawn);
  const dist = cumulativeDistance(session.points);
  const total = drawnDist[drawnDist.length - 1]?.distanceM ?? 0;

  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const q of drawn) {
    w = Math.min(w, q.lng);
    e = Math.max(e, q.lng);
    s = Math.min(s, q.lat);
    n = Math.max(n, q.lat);
  }

  // A color stop wherever the step changes along the line.
  const stops: ColorStop[] = [];
  let lastIdx = Number.NaN;
  drawn.forEach((q, i) => {
    const entry = stepAtOffset(session.log, q.tOffsetMs);
    const idx = entry?.idx ?? -1;
    if (idx === lastIdx) return;
    lastIdx = idx;
    const step = entry ? session.steps.find((r) => r.idx === entry.idx)?.step : undefined;
    const at = total > 0 ? drawnDist[i]!.distanceM / total : 0;
    const color = step ? toneColor(p, stepTone(step)) : p.run.color;
    if (stops.length > 0 && at <= stops[stops.length - 1]!.at) stops[stops.length - 1] = { at: stops[stops.length - 1]!.at, color };
    else stops.push({ at: stops.length === 0 ? 0 : at, color });
  });

  // Mile (or km) markers at each whole unit, interpolated between samples.
  const unitM = unit === 'mi' ? METERS_PER_MILE : 1000;
  const markers: RouteGeometry['markers'] = { type: 'FeatureCollection', features: [] };
  let next = unitM;
  for (let i = 1; i < dist.length; i++) {
    const a = dist[i - 1]!;
    const b = dist[i]!;
    while (b.distanceM >= next) {
      const f = b.distanceM > a.distanceM ? (next - a.distanceM) / (b.distanceM - a.distanceM) : 0;
      const pos = positionAt(session.points, a.tOffsetMs + f * (b.tOffsetMs - a.tOffsetMs));
      if (pos) markers.features.push({ type: 'Feature', properties: { label: String(Math.round(next / unitM)) }, geometry: { type: 'Point', coordinates: [pos.lng, pos.lat] } });
      next += unitM;
    }
  }

  const first = drawn[0]!;
  const last = drawn[drawn.length - 1]!;
  return {
    line: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: drawn.map((q) => [q.lng, q.lat]) } },
    start: point(first.lng, first.lat),
    finish: point(last.lng, last.lat),
    markers,
    bounds: [w, s, e, n],
    stops,
    drawn,
    drawnDist,
    dist,
  };
}

/**
 * `line-gradient` for the step colors. With `upTo`, everything past that fraction is drawn
 * in `rest`: the replay trail grows over a faint full route.
 */
export function gradient(stops: readonly ColorStop[], upTo?: number, rest?: string): ExpressionSpecification {
  const out: (string | number)[] = [];
  let first = true;
  for (const st of stops) {
    if (upTo !== undefined && st.at >= upTo) break;
    if (first) out.push(st.color);
    else out.push(st.at, st.color);
    first = false;
  }
  if (first) out.push(rest ?? stops[0]?.color ?? '#000');
  else if (upTo !== undefined && upTo < 1) out.push(Math.max(upTo, 1e-6), rest ?? '#000');
  // `step` needs at least one stop; a single color repeats itself at the end.
  if (out.length === 1) out.push(1, out[0]!);
  return ['step', ['line-progress'], ...out] as unknown as ExpressionSpecification;
}

/** Distance at a time offset, interpolated. */
export function distanceAt(d: readonly DistancePoint[], tOffsetMs: number): number {
  if (d.length === 0) return 0;
  if (tOffsetMs <= d[0]!.tOffsetMs) return d[0]!.distanceM;
  const last = d[d.length - 1]!;
  if (tOffsetMs >= last.tOffsetMs) return last.distanceM;
  let lo = 0;
  let hi = d.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid]!.tOffsetMs <= tOffsetMs) lo = mid;
    else hi = mid;
  }
  const a = d[lo]!;
  const b = d[hi]!;
  return a.distanceM + ((tOffsetMs - a.tOffsetMs) / (b.tOffsetMs - a.tOffsetMs)) * (b.distanceM - a.distanceM);
}

/** Time spent paused before an offset. */
export function pausedBefore(pauses: readonly (readonly [number, number])[], tOffsetMs: number): number {
  let ms = 0;
  for (const [a, b] of pauses) if (tOffsetMs > a) ms += Math.min(tOffsetMs, b) - a;
  return ms;
}

/** Cool to warm, for value coloring. Low values take the first color. */
const RAMP = ['#3B82F6', '#14B8A6', '#84CC16', '#EAB308', '#F97316', '#EF4444'];
const LEVELS = 16;
const MAX_STOPS = 240;

function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  const ch = (k: number) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - f) + parseInt(b.slice(k, k + 2), 16) * f);
  return `#${[1, 3, 5].map((k) => ch(k).toString(16).padStart(2, '0')).join('')}`;
}

/** The ramp as evenly spaced colors, for the legend. */
export const RAMP_COLORS = RAMP;

/**
 * Color stops from one value per drawn point (routeValues). Values are bucketed to at most
 * MAX_STOPS stops and quantized to LEVELS colors so neighbors merge. `invert` puts low values
 * at the warm end (pace: faster is warmer). Points without a value are `neutral`.
 */
export function valueStops(route: RouteGeometry, values: readonly (number | undefined)[], range: [number, number], neutral: string, invert = false): ColorStop[] {
  const total = route.drawnDist[route.drawnDist.length - 1]?.distanceM ?? 0;
  const n = values.length;
  const per = Math.max(1, Math.ceil(n / MAX_STOPS));
  const span = range[1] - range[0];
  const stops: ColorStop[] = [];
  for (let i = 0; i < n; i += per) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < Math.min(n, i + per); j++) {
      const v = values[j];
      if (v !== undefined) {
        sum += v;
        count++;
      }
    }
    let color = neutral;
    if (count > 0) {
      const t = span > 0 ? (sum / count - range[0]) / span : 0.5;
      color = rampColor(Math.round((invert ? 1 - t : t) * (LEVELS - 1)) / (LEVELS - 1));
    }
    const at = total > 0 && i > 0 ? route.drawnDist[i]!.distanceM / total : 0;
    const prev = stops[stops.length - 1];
    if (prev && prev.color === color) continue;
    if (prev && at <= prev.at) stops[stops.length - 1] = { at: prev.at, color };
    else stops.push({ at, color });
  }
  return stops;
}

/** The drawn point nearest a tap, by flat distance in meters, or undefined when farther than `maxM`. */
export function nearestDrawn(route: RouteGeometry, lng: number, lat: number, maxM: number): number | undefined {
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  let best = -1;
  let bestD = Infinity;
  route.drawn.forEach((q, i) => {
    const d = Math.hypot((q.lng - lng) * kx, (q.lat - lat) * ky);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best >= 0 && bestD <= maxM ? best : undefined;
}
