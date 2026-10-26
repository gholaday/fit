import { describe, expect, it } from 'vitest';
import type { AgendaItem } from './agenda';
import { findMergeTarget, matchPlanItem } from './external';
import { computeZones } from './hr';
import { base64Bytes, hrStats, mergeHr, parseHrMeasurement, type HrSample } from './session/heart';

const at = (date: string, hh: number, mm = 0) => new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();
const min = 60000;

describe('parseHrMeasurement', () => {
  it.each([
    ['8-bit, no contact info', [0x00, 72], { bpm: 72, rrMs: [] }],
    ['8-bit, contact detected', [0x06, 140], { bpm: 140, contact: true, rrMs: [] }],
    ['16-bit with energy and RR', [0x19, 0x2c, 0x01, 0x10, 0x00, 0x00, 0x04], { bpm: 300, rrMs: [1000] }],
  ])('%s', (_label, bytes, expected) => {
    expect(parseHrMeasurement(Uint8Array.from(bytes))).toEqual(expected);
  });

  it('decodes base64 notification values', () => {
    expect([...base64Bytes('AEg=')]).toEqual([0x00, 72]);
  });
});

describe('heart-rate samples', () => {
  const s = (t: number, bpm: number, source: HrSample['source'] = 'ble'): HrSample => ({ tOffsetMs: t * 1000, bpm, source });

  it('fills only live dropouts with Health Connect samples', () => {
    const live = [s(0, 120), s(1, 121), s(20, 130), s(21, 131)];
    const health = [s(1, 100, 'health_connect'), s(10, 125, 'health_connect'), s(21, 99, 'health_connect')];
    expect(mergeHr(live, health, 22000).map((x) => x.bpm)).toEqual([120, 121, 125, 130, 131]);
  });

  it('weights by time, caps dropouts, skips pauses and splits by step', () => {
    const zones = computeZones({ method: 'max', maxHr: 200 }); // Z2 = 120-140
    const samples = [s(0, 130), s(60, 170), s(120, 130)];
    const stats = hrStats(samples, zones, {
      endMs: 180000,
      pauses: [[120000, 180000]],
      log: [
        { idx: 0, startActiveMs: 0, endActiveMs: 60000, startOffsetMs: 0, endOffsetMs: 60000, startDistanceM: 0, endDistanceM: 0, skipped: false },
        { idx: 1, startActiveMs: 60000, endActiveMs: 120000, startOffsetMs: 60000, endOffsetMs: 120000, startDistanceM: 0, endDistanceM: 0, skipped: false },
      ],
    });
    // Each live sample holds 5 s at most; the paused one does not count.
    expect(stats).toEqual({ avgBpm: 150, maxBpm: 170, zoneSeconds: [0, 5, 0, 5, 0], stepAvgBpm: { 0: 130, 1: 170 } });
  });
});

describe('external sessions', () => {
  it('merges into the phone session covering more than half of it', () => {
    const watch = { startMs: at('2026-10-26', 7, 0), endMs: at('2026-10-26', 7, 40) };
    const phone = [
      { id: 'short', startMs: at('2026-10-26', 7, 0), endMs: at('2026-10-26', 7, 15) },
      { id: 'run', startMs: at('2026-10-26', 7, 1), endMs: at('2026-10-26', 7, 41) },
    ];
    expect(findMergeTarget(watch, phone)?.id).toBe('run');
    expect(findMergeTarget(watch, phone.slice(0, 1))).toBeUndefined();
  });

  it('suggests a same-lane item within a day and 30% of its duration', () => {
    const item = (key: string, date: string, lane: AgendaItem['lane'], minutes: number, extra: Partial<AgendaItem> = {}): AgendaItem => ({
      key,
      lane,
      date,
      originalDate: date,
      source: { type: 'plan_workout', planWorkoutId: key, planId: 'p', weekIndex: 0, role: 'easy' },
      title: key,
      refId: key,
      hard: false,
      estSeconds: minutes * 60,
      status: 'pending',
      ...extra,
    });
    const run = { startMs: at('2026-10-26', 7), endMs: at('2026-10-26', 7) + 38 * min, activity: 'run' as const };
    const agenda = [
      item('stretch', '2026-10-26', 'stretch', 10),
      item('long', '2026-10-26', 'run', 90),
      item('z2', '2026-10-25', 'run', 40),
      item('recorded', '2026-10-26', 'run', 40, { status: 'done', sessionId: 's1' }),
      item('old', '2026-10-20', 'run', 40),
    ];
    const m = matchPlanItem(run, agenda);
    expect(m.suggested?.key).toBe('z2');
    expect(m.candidates.map((c) => c.key)).toEqual(['z2', 'long', 'stretch']);
    expect(matchPlanItem({ ...run, endMs: run.startMs + 10 * min }, agenda).suggested).toBeUndefined();
  });
});
