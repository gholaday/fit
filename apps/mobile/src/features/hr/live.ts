/**
 * Live heart rate from the remembered sensor (spec §7). Holds the latest reading for the
 * pre-start row, the sensor screen and the in-run gauge, and hands every reading to the
 * run engine, which buffers samples and saves them with progress. While anything holds
 * the sensor, failed connects are retried quietly; the native side already reconnects
 * after a drop.
 */
import { parseHrMeasurement } from '@fit/core';
import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import { useFit } from '@/data/store';
import { connect, disconnect, onMeasurement, sensorAvailable, useSensor } from './sensor';

export interface HrLive {
  /** Latest reading, cleared when the sensor goes quiet. */
  bpm?: number;
  /** Seconds in Zone 2 so far, from hrStats() at each save. */
  zone2S?: number;
}

export const useHrLive = create<HrLive>()(() => ({}));

/** A reading older than this is not shown. */
const STALE_MS = 5000;
const RETRY_MS = 10_000;

type Sink = (bpm: number, t: number) => void;
let sink: Sink | undefined;
let holders = 0;
/** Connected (or connecting) to this sensor on behalf of the holders. */
let activeId: string | undefined;
let stopMeasure: (() => void) | undefined;
let unwatch: (() => void) | undefined;
let staleTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

export async function sensorPermitted(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < 31) return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  const [scan, conn] = await Promise.all([PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN), PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT)]);
  return scan && conn;
}

function onBytes(bytes: number[], t: number): void {
  const m = parseHrMeasurement(Uint8Array.from(bytes));
  // Zero, or a strap reporting no skin contact, is not a heart rate.
  if (!m || m.bpm <= 0 || m.contact === false) return;
  if (useHrLive.getState().bpm !== m.bpm) useHrLive.setState({ bpm: m.bpm });
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => useHrLive.setState({ bpm: undefined }), STALE_MS);
  sink?.(m.bpm, t);
}

async function start(): Promise<void> {
  const remembered = useFit.getState().settings.hrSensor;
  if (activeId || !remembered || !sensorAvailable() || !(await sensorPermitted()) || holders === 0) return;
  const id = remembered.id;
  activeId = id;
  stopMeasure = onMeasurement((e) => onBytes(e.bytes, e.t));
  unwatch = useSensor.subscribe((s, prev) => {
    if (s.connection === prev.connection || s.connection !== 'failed') return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (activeId === id) void connect(id);
    }, RETRY_MS);
  });
  const s = useSensor.getState();
  if (s.id !== id || s.connection === undefined || s.connection === 'failed' || s.connection === 'disconnected') await connect(id);
}

function stop(): void {
  if (!activeId) return;
  activeId = undefined;
  clearTimeout(retryTimer);
  clearTimeout(staleTimer);
  unwatch?.();
  stopMeasure?.();
  unwatch = stopMeasure = undefined;
  disconnect();
  useHrLive.setState({ bpm: undefined });
}

/**
 * Keeps the remembered sensor connected until the returned release is called. A run holds
 * it from pre-start to finish; the sensor screen holds it while open. Without a remembered
 * sensor or permission it does nothing (the sensor screen asks for permission).
 */
export function holdSensor(): () => void {
  holders++;
  void start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    if (holders === 0) stop();
  };
}

/** After the remembered sensor changes: reconnect for whoever holds it. */
export function sensorChanged(): void {
  stop();
  void start();
}

/** The run engine's sample buffer; undefined stops collecting. */
export function setHrSink(fn: Sink | undefined): void {
  sink = fn;
  if (!fn) useHrLive.setState({ zone2S: undefined });
}
