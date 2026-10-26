/**
 * Bluetooth heart rate sensor service (spec §7 Live HR source): permissions, scanning,
 * connecting and the raw measurement feed. Holds connection state for the UI; parsing and
 * storage go through @fit/core and the repository once their contract lands, so nothing
 * here interprets the bytes.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import { HrSensor, type HrConnectionState, type HrDevice, type HrMeasurementEvent } from '../../../modules/hr-sensor';

export type { HrDevice, HrMeasurementEvent };

interface SensorState {
  /** Devices seen in the current scan, strongest signal first. */
  devices: HrDevice[];
  scanning: boolean;
  /** Device connect() was last called for, until disconnect(). */
  id?: string;
  connection?: HrConnectionState;
  /** Why the last connection failed, when it did. */
  failure?: string;
}

export const useSensor = create<SensorState>()(() => ({ devices: [], scanning: false }));

export const sensorAvailable = (): boolean => HrSensor !== undefined && HrSensor.state() !== 'unsupported';
export const bluetoothOn = (): boolean => HrSensor?.state() === 'on';

/** Scan and connect permissions; Android 11 and below need location instead, which runs already hold. */
export async function requestSensorPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < 31) {
    return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) === 'granted';
  }
  const result = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]);
  return Object.values(result).every((r) => r === 'granted');
}

let scanSub: { remove(): void } | undefined;
let scanTimer: ReturnType<typeof setTimeout> | undefined;
/** Matches the native scan timeout. */
const SCAN_MS = 30_000;

/** Starts a scan; results land in useSensor().devices. False when it could not start. */
export function startScan(): boolean {
  if (!HrSensor) return false;
  stopScan();
  useSensor.setState({ devices: [], scanning: true });
  scanSub = HrSensor.addListener('onDevice', (d) => {
    useSensor.setState((s) => {
      const others = s.devices.filter((x) => x.id !== d.id);
      return { devices: [...others, d].sort((a, b) => b.rssi - a.rssi) };
    });
  });
  if (!HrSensor.startScan()) {
    stopScan();
    return false;
  }
  scanTimer = setTimeout(stopScan, SCAN_MS);
  return true;
}

export function stopScan(): void {
  clearTimeout(scanTimer);
  scanSub?.remove();
  scanSub = undefined;
  HrSensor?.stopScan();
  if (useSensor.getState().scanning) useSensor.setState({ scanning: false });
}

let connectionSub: { remove(): void } | undefined;

export async function connect(id: string): Promise<void> {
  if (!HrSensor) return;
  stopScan();
  connectionSub ??= HrSensor.addListener('onConnection', (e) => {
    if (e.id !== useSensor.getState().id) return;
    useSensor.setState({ connection: e.state, failure: e.state === 'failed' ? e.reason : undefined });
  });
  useSensor.setState({ id, connection: 'connecting', failure: undefined });
  await HrSensor.connect(id);
}

export function disconnect(): void {
  HrSensor?.disconnect();
  useSensor.setState({ id: undefined, connection: undefined, failure: undefined });
}

/** Raw Heart Rate Measurement notifications from the connected sensor; returns the unsubscribe. */
export function onMeasurement(fn: (e: HrMeasurementEvent) => void): () => void {
  const sub = HrSensor?.addListener('onMeasurement', fn);
  return () => sub?.remove();
}
