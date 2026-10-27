import { describe, expect, it } from 'vitest';
import type { StepLogEntry } from './player';
import { parseGpx } from './route';
import { DEFAULT_TREADMILL, rescaleLog, setSpeed, treadmillDistance, treadmillTarget } from './treadmill';

const entry = (idx: number, startS: number, endS: number, startM: number, endM: number): StepLogEntry => ({
  idx,
  startActiveMs: startS * 1000,
  endActiveMs: endS * 1000,
  startOffsetMs: startS * 1000,
  endOffsetMs: endS * 1000,
  startDistanceM: startM,
  endDistanceM: endM,
  skipped: false,
});

describe('treadmill', () => {
  it('integrates speed changes over active time', () => {
    let segs = setSpeed([], 0, 9);
    segs = setSpeed(segs, 60_000, 12);
    segs = setSpeed(segs, 60_000, 10.8); // a second press at the same moment replaces it
    // 60 s at 2.5 m/s + 30 s at 3 m/s
    expect(treadmillDistance(segs, 90_000)).toBeCloseTo(240);
    expect(treadmillDistance(segs, 30_000)).toBeCloseTo(75);
  });

  it('suggests speeds from the step target', () => {
    const run = { id: 'a', activity: 'run' as const, duration: { type: 'open' as const } };
    expect(treadmillTarget({ ...run, target: { type: 'pace_range', minSecPerKm: 300, maxSecPerKm: 360 } }, DEFAULT_TREADMILL)).toEqual({ speedKph: 10.9 });
    expect(treadmillTarget({ ...run, activity: 'walk', target: { type: 'none' } }, DEFAULT_TREADMILL)).toEqual({ speedKph: 5 });
  });

  it.each([
    ['scales recorded step distances', [entry(0, 0, 60, 0, 200), entry(1, 60, 120, 200, 500)], 600, [240, 600]],
    ['spreads a timer total by active time', [entry(0, 0, 60, 0, 0), entry(1, 60, 180, 0, 0)], 900, [300, 900]],
  ])('%s', (_label, log, total, ends) => {
    expect(rescaleLog(log, total).map((e) => Math.round(e.endDistanceM))).toEqual(ends);
  });
});

describe('GPX', () => {
  it('reads points, elevation and Garmin HR', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin Connect" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>Tuesday run &amp; walk</name><trkseg>
<trkpt lat="47.6000000" lon="-122.3000000"><ele>12.0</ele><time>2026-10-27T07:00:00.000Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>131</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="47.6000300" lon="-122.3000000"><time>2026-10-27T07:00:01.000Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>131</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
</trkseg></trk></gpx>`;
    const parsed = parseGpx(gpx);
    expect(parsed.startedAt).toBe('2026-10-27T07:00:00.000Z');
    expect(parsed.points).toEqual([
      { tOffsetMs: 0, lat: 47.6, lng: -122.3, alt: 12, accuracy: 5 },
      { tOffsetMs: 1000, lat: 47.60003, lng: -122.3, accuracy: 5 },
    ]);
    expect(parsed.hr.map((h) => [h.tOffsetMs, h.bpm])).toEqual([
      [0, 131],
      [1000, 131],
    ]);
  });
});
