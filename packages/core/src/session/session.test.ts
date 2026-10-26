import { describe, expect, it } from 'vitest';
import { counterIds, parseWorkout } from '../dsl';
import { cuesFor, DEFAULT_CUE_PREFS, initialCueState, type CueContext } from './cues';
import { addFix, autoPause, initialGpsFilter, type GpsFix } from './geo';
import { createPlayer, playerReducer, snapshot } from './player';
import { simplify, splits } from './track';

const T0 = Date.UTC(2026, 9, 26, 7, 0, 0);
const sec = (s: number) => T0 + s * 1000;
// ~11.1 m per 0.0001 deg of latitude.
const fix = (s: number, lat: number, accuracy = 5): GpsFix => ({ t: sec(s), lat, lng: -122, accuracy });

describe('GPS filter', () => {
  it('rejects inaccurate fixes and impossible jumps, keeps distance on the smoothed path', () => {
    let st = initialGpsFilter();
    st = addFix(st, fix(0, 47.0)).state;
    expect(addFix(st, fix(1, 47.00003, 40)).verdict).toBe('inaccurate');
    expect(addFix(st, fix(1, 47.001)).verdict).toBe('jump'); // ~111 m in 1 s
    for (let i = 1; i <= 10; i++) st = addFix(st, fix(i, 47.0 + i * 0.00003)).state; // ~3.3 m/s
    expect(st.distanceM).toBeGreaterThan(25);
    expect(st.distanceM).toBeLessThan(34);
  });
});

describe('autoPause', () => {
  it('pauses after 6 s below 0.6 m/s and resumes above 1.0 m/s', () => {
    let st = autoPause({ paused: false }, 0.2, sec(0));
    st = autoPause(st, 0.3, sec(5));
    expect(st.paused).toBe(false);
    st = autoPause(st, 0.3, sec(6));
    expect(st.paused).toBe(true);
    expect(autoPause(st, 0.8, sec(7)).paused).toBe(true);
    expect(autoPause(st, 1.2, sec(7)).paused).toBe(false);
  });
});

describe('player', () => {
  const items = parseWorkout('5m walk, 2x [ 30s sprint, 90s walk ], 400m easy', counterIds());

  it('advances through several time steps after a long background gap, at exact boundaries', () => {
    let p = playerReducer(createPlayer(items), { type: 'start', t: sec(0) });
    p = playerReducer(p, { type: 'tick', t: sec(300 + 30 + 90 + 10), distanceM: 1000 });
    expect(p.stepIdx).toBe(3); // second sprint, 10 s in
    expect(p.log.map((e) => e.endActiveMs)).toEqual([300_000, 330_000, 420_000]);
    expect(snapshot(p, sec(440), 1000).stepRemainingMs).toBe(10_000);
  });

  it('excludes paused time and advances distance steps by meters', () => {
    let p = playerReducer(createPlayer(items), { type: 'start', t: sec(0) });
    p = playerReducer(p, { type: 'pause', t: sec(100) });
    p = playerReducer(p, { type: 'resume', t: sec(160) });
    p = playerReducer(p, { type: 'tick', t: sec(300), distanceM: 0 });
    expect(p.stepIdx).toBe(0); // only 240 s active
    expect(p.pauses).toEqual([[100_000, 160_000]]);
    p = playerReducer(p, { type: 'tick', t: sec(60 + 300 + 240), distanceM: 500 });
    expect(p.stepIdx).toBe(5); // into the 400 m run, which starts at 500 m
    p = playerReducer(p, { type: 'tick', t: sec(700), distanceM: 899 });
    expect(p.status).toBe('active');
    p = playerReducer(p, { type: 'tick', t: sec(710), distanceM: 900 });
    expect(p.status).toBe('finished');
    expect(p.log).toHaveLength(6);
  });
});

describe('cues', () => {
  const step = parseWorkout('20m @ tempo', counterIds())[0] as never;
  const ctx: CueContext = { unit: 'mi', prefs: DEFAULT_CUE_PREFS, paceRange: () => ({ minSecPerKm: 300, maxSecPerKm: 320 }) };
  const snap = { status: 'active' as const, stepIdx: 0, stepCount: 1, step, activeMs: 0, stepElapsedMs: 0 };

  it('nudges after 30 s out of range, at most once a minute', () => {
    let st = initialCueState();
    const run = (s: number, pace: number) => {
      const r = cuesFor(st, { snap, t: sec(s), distanceM: 0, currentPace: pace }, ctx);
      st = r.state;
      return r.cues.map((c) => c.text);
    };
    expect(run(0, 340)).toEqual([]);
    expect(run(29, 340)).toEqual([]);
    expect(run(30, 340)).toEqual(['A little faster.']);
    expect(run(60, 340)).toEqual([]);
    expect(run(90, 340)).toEqual(['A little faster.']);
    expect(run(95, 310)).toEqual([]); // back in range resets
    expect(run(100, 280)).toEqual([]);
    expect(run(150, 280)).toEqual(['Ease off.']);
    expect(cuesFor(st, { snap, t: sec(210), distanceM: 0, currentPace: 280 }, { ...ctx, treadmill: true }).cues.map((c) => c.text)).toEqual(['Lower the speed.']);
  });
});

describe('track', () => {
  it('splits a steady 10:00 /mi run into full miles plus a partial', () => {
    const mile = 1609.344;
    const samples = Array.from({ length: 26 }, (_, i) => ({ tOffsetMs: i * 60_000, distanceM: (i * mile) / 10 }));
    const out = splits(samples, 'mi');
    expect(out.map((s) => s.partial)).toEqual([false, false, true]);
    expect(out[0]!.durationS).toBeCloseTo(600, 0);
    expect(out[2]!.distanceM).toBeCloseTo(mile / 2, 0);
  });

  it('collapses a straight line to its endpoints', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ tOffsetMs: i * 1000, lat: 47 + i * 0.0001, lng: -122, accuracy: 5 }));
    expect(simplify(line, 1)).toHaveLength(2);
  });
});
