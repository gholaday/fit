import { zoneForBpm, type HrZoneBand } from '../hr';
import type { HrZone } from '../workout';
import type { StepLogEntry } from './player';

/**
 * Heart-rate samples on a session (spec §7 Live HR source, §11 HR on phone sessions).
 * Live samples come from a BLE HR broadcast; Health Connect samples arrive after the
 * watch syncs and only fill gaps in the live trace.
 */

export type HrSource = 'ble' | 'health_connect';

export interface HrSample {
  /** Wall-clock ms since session start (same clock as track points). */
  tOffsetMs: number;
  bpm: number;
  source: HrSource;
}

export interface HrMeasurement {
  bpm: number;
  /** Undefined when the sensor does not report skin contact. */
  contact?: boolean;
  /** Beat-to-beat intervals, ms. */
  rrMs: number[];
}

/**
 * Parses the Heart Rate Measurement characteristic (0x2A37). Flags byte: bit 0 means a
 * 16-bit value, bits 1-2 sensor contact, bit 3 energy expended present, bit 4 RR present
 * (1/1024 s units).
 */
export function parseHrMeasurement(bytes: Uint8Array): HrMeasurement | undefined {
  if (bytes.length < 2) return undefined;
  const flags = bytes[0]!;
  const wide = (flags & 0x01) !== 0;
  if (wide && bytes.length < 3) return undefined;
  const bpm = wide ? bytes[1]! | (bytes[2]! << 8) : bytes[1]!;
  let i = wide ? 3 : 2;
  if (flags & 0x08) i += 2;
  const rrMs: number[] = [];
  if (flags & 0x10) {
    for (; i + 1 < bytes.length; i += 2) rrMs.push(Math.round(((bytes[i]! | (bytes[i + 1]! << 8)) * 1000) / 1024));
  }
  const m: HrMeasurement = { bpm, rrMs };
  if (flags & 0x04) m.contact = (flags & 0x02) !== 0;
  return m;
}

/** Base64 notification value (react-native-ble-plx) to bytes, without Buffer or atob. */
export function base64Bytes(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of clean) {
    acc = (acc << 6) | alphabet.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/** A sample counts for at most this long; longer silences are gaps (dropouts). */
export const HR_GAP_MS = 5000;

/** Wall-clock ranges with no live sample for longer than `gapMs`, within [0, endMs]. */
export function hrGaps(samples: readonly HrSample[], endMs: number, gapMs = HR_GAP_MS): [number, number][] {
  const gaps: [number, number][] = [];
  let last = 0;
  for (const s of samples) {
    if (s.tOffsetMs - last > gapMs) gaps.push([last, s.tOffsetMs]);
    last = Math.max(last, s.tOffsetMs);
  }
  if (endMs - last > gapMs) gaps.push([last, endMs]);
  return gaps;
}

/**
 * Live samples win; Health Connect samples are kept only inside gaps of the live trace,
 * so a dropout is filled and a complete live trace is left alone.
 */
export function mergeHr(live: readonly HrSample[], health: readonly HrSample[], endMs: number): HrSample[] {
  if (live.length === 0) return [...health].sort((a, b) => a.tOffsetMs - b.tOffsetMs);
  const gaps = hrGaps(live, endMs);
  const fill = health.filter((h) => gaps.some(([a, b]) => h.tOffsetMs > a && h.tOffsetMs < b));
  return [...live, ...fill].sort((a, b) => a.tOffsetMs - b.tOffsetMs);
}

export interface HrStats {
  avgBpm: number;
  maxBpm: number;
  /** Seconds per zone, Z1..Z5 (index 0 is Z1). */
  zoneSeconds: [number, number, number, number, number];
  /** Time-weighted average per step index, for steps with samples. */
  stepAvgBpm: Record<number, number>;
}

/**
 * Time-weighted stats: each sample holds until the next one, capped at HR_GAP_MS so a
 * dropout does not stretch the last reading. Paused time is excluded.
 */
export function hrStats(
  samples: readonly HrSample[],
  zones: readonly HrZoneBand[],
  opts: { endMs: number; pauses?: readonly (readonly [number, number])[]; log?: readonly StepLogEntry[] },
): HrStats | undefined {
  const pauses = opts.pauses ?? [];
  const paused = (t: number) => pauses.some(([a, b]) => t >= a && t < b);
  const zoneSeconds: HrStats['zoneSeconds'] = [0, 0, 0, 0, 0];
  const step = new Map<number, { w: number; sum: number }>();
  let weight = 0;
  let sum = 0;
  let max = 0;
  samples.forEach((s, i) => {
    if (paused(s.tOffsetMs)) return;
    const next = samples[i + 1]?.tOffsetMs ?? opts.endMs;
    const ms = Math.max(0, Math.min(next - s.tOffsetMs, HR_GAP_MS));
    max = Math.max(max, s.bpm);
    if (ms === 0) return;
    weight += ms;
    sum += s.bpm * ms;
    zoneSeconds[zoneForBpm(s.bpm, zones) - 1]! += ms / 1000;
    const entry = opts.log?.find((e) => s.tOffsetMs >= e.startOffsetMs && s.tOffsetMs < e.endOffsetMs);
    if (entry) {
      const acc = step.get(entry.idx) ?? { w: 0, sum: 0 };
      acc.w += ms;
      acc.sum += s.bpm * ms;
      step.set(entry.idx, acc);
    }
  });
  if (weight === 0) return undefined;
  const stepAvgBpm: Record<number, number> = {};
  for (const [idx, acc] of step) stepAvgBpm[idx] = Math.round(acc.sum / acc.w);
  return { avgBpm: Math.round(sum / weight), maxBpm: max, zoneSeconds: zoneSeconds.map((s) => Math.round(s)) as HrStats['zoneSeconds'], stepAvgBpm };
}

/** Seconds in one zone, for the Zone 2 gauge. */
export const secondsInZone = (stats: HrStats, zone: HrZone) => stats.zoneSeconds[zone - 1];

/** Bucket averages for charts, at most `maxPoints` samples. */
export function downsampleHr(samples: readonly HrSample[], maxPoints = 600): HrSample[] {
  if (samples.length <= maxPoints) return [...samples];
  const size = Math.ceil(samples.length / maxPoints);
  const out: HrSample[] = [];
  for (let i = 0; i < samples.length; i += size) {
    const chunk = samples.slice(i, i + size);
    out.push({ tOffsetMs: chunk[0]!.tOffsetMs, bpm: Math.round(chunk.reduce((a, s) => a + s.bpm, 0) / chunk.length), source: chunk[0]!.source });
  }
  return out;
}
