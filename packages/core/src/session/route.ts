import type { Step } from '../workout';
import { haversineM, type TrackPoint } from './geo';
import type { HrSample } from './heart';

/** Route extras for the summary (spec §5 Route map & replay): coloring, GPX, titles. */

export type RouteColorBy = 'step' | 'pace' | 'hr' | 'elevation';

/**
 * One value per point for pace (sec/km over a ~20 s window), HR (nearest sample within
 * 5 s) or elevation (m). undefined where there is no data; the map draws those neutral.
 * 'step' coloring comes from the step log, not from here.
 */
export function routeValues(points: readonly TrackPoint[], by: Exclude<RouteColorBy, 'step'>, hr: readonly HrSample[] = []): (number | undefined)[] {
  if (by === 'elevation') return points.map((p) => p.alt);
  if (by === 'hr') {
    let j = 0;
    return points.map((p) => {
      while (j + 1 < hr.length && Math.abs(hr[j + 1]!.tOffsetMs - p.tOffsetMs) <= Math.abs(hr[j]!.tOffsetMs - p.tOffsetMs)) j++;
      const s = hr[j];
      return s && Math.abs(s.tOffsetMs - p.tOffsetMs) <= 5000 ? s.bpm : undefined;
    });
  }
  const cum: number[] = [];
  points.forEach((p, i) => cum.push(i === 0 ? 0 : cum[i - 1]! + haversineM(points[i - 1]!, p)));
  let lo = 0;
  return points.map((p, i) => {
    while (p.tOffsetMs - points[lo]!.tOffsetMs > 20_000) lo++;
    const dt = (p.tOffsetMs - points[lo]!.tOffsetMs) / 1000;
    const dm = cum[i]! - cum[lo]!;
    return dt >= 5 && dm >= 5 ? (dt / dm) * 1000 : undefined;
  });
}

/** Low and high bounds for the color scale, ignoring the outer 5% of values. */
export function valueRange(values: readonly (number | undefined)[]): [number, number] | undefined {
  const v = values.filter((x): x is number => x !== undefined).sort((a, b) => a - b);
  if (v.length === 0) return undefined;
  return [v[Math.floor(v.length * 0.05)]!, v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)]!];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GPX 1.1 with Garmin's TrackPointExtension for HR, readable by Strava and Garmin Connect. */
export function toGpx(input: { name: string; startedAt: string; points: readonly TrackPoint[]; hr?: readonly HrSample[] }): string {
  const t0 = Date.parse(input.startedAt);
  const bpm = input.hr && input.hr.length > 0 ? routeValues(input.points, 'hr', input.hr) : [];
  const pts = input.points
    .map((p, i) => {
      const ele = p.alt === undefined ? '' : `<ele>${p.alt.toFixed(1)}</ele>`;
      const hr = bpm[i] === undefined ? '' : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${bpm[i]}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
      return `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}<time>${new Date(t0 + p.tOffsetMs).toISOString()}</time>${hr}</trkpt>`;
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Fit" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    `<metadata><name>${esc(input.name)}</name><time>${new Date(t0).toISOString()}</time></metadata>`,
    `<trk><name>${esc(input.name)}</name><trkseg>`,
    pts,
    '</trkseg></trk></gpx>',
    '',
  ].join('\n');
}

export interface ParsedGpx {
  /** First point's time; undefined if the file has no timestamps. */
  startedAt?: string;
  points: TrackPoint[];
  hr: HrSample[];
}

/**
 * Reads track points (and Garmin HR extensions) from a GPX file, e.g. a Garmin Connect
 * export attached to a watch-only run. Points without time are spaced 1 s apart.
 */
export function parseGpx(xml: string): ParsedGpx {
  const points: TrackPoint[] = [];
  const hr: HrSample[] = [];
  let t0: number | undefined;
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1] ?? m[3] ?? '';
    const body = m[2] ?? '';
    const lat = Number(/\blat="([^"]+)"/.exec(attrs)?.[1]);
    const lng = Number(/\blon="([^"]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const time = /<time>([^<]+)<\/time>/.exec(body)?.[1];
    const ms = time ? Date.parse(time) : NaN;
    if (t0 === undefined && Number.isFinite(ms)) t0 = ms;
    const tOffsetMs = Number.isFinite(ms) && t0 !== undefined ? ms - t0 : points.length * 1000;
    const p: TrackPoint = { tOffsetMs, lat, lng, accuracy: 5 };
    const ele = Number(/<ele>([^<]+)<\/ele>/.exec(body)?.[1]);
    if (Number.isFinite(ele)) p.alt = ele;
    points.push(p);
    const bpm = Number(/<(?:\w+:)?hr>(\d+)<\/(?:\w+:)?hr>/.exec(body)?.[1]);
    if (Number.isFinite(bpm) && bpm > 0) hr.push({ tOffsetMs, bpm, source: 'health_connect' });
  }
  const out: ParsedGpx = { points, hr };
  if (t0 !== undefined) out.startedAt = new Date(t0).toISOString();
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Title for a session without a plan or workout name (spec §5 summary, "Tuesday
 * Intervals"), in sentence case per the copy rules: "Tuesday intervals", "Saturday run".
 */
export function autoTitle(startedAt: Date, steps: readonly Step[]): string {
  const day = WEEKDAYS[startedAt.getDay()]!;
  const sprints = steps.filter((s) => s.activity === 'sprint').length;
  const runs = steps.filter((s) => s.activity === 'run').length;
  const walks = steps.filter((s) => s.activity === 'walk').length;
  const kind = sprints >= 2 ? 'intervals' : runs === 0 && walks > 0 ? 'walk' : runs > 0 && walks >= 2 ? 'run and walk' : 'run';
  return `${day} ${kind}`;
}
