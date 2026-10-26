import { type NativeModule, requireOptionalNativeModule } from 'expo';

export interface HrDevice {
  /** Bluetooth address, stable per device. */
  id: string;
  name: string | null;
  rssi: number;
}

export type HrConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export interface HrConnectionEvent {
  id: string;
  state: HrConnectionState;
  /** "no-hr-service" when the device does not expose Heart Rate Measurement. */
  reason?: string;
}

export interface HrMeasurementEvent {
  id: string;
  /** Epoch ms when the notification arrived. */
  t: number;
  /** Raw Heart Rate Measurement (0x2A37) bytes, parsed in @fit/core. */
  bytes: number[];
}

type HrSensorEvents = {
  onDevice(event: HrDevice): void;
  onConnection(event: HrConnectionEvent): void;
  onMeasurement(event: HrMeasurementEvent): void;
};

declare class HrSensorModule extends NativeModule<HrSensorEvents> {
  state(): 'on' | 'off' | 'unsupported';
  /** Scans for Heart Rate service devices for up to 30 s. False without Bluetooth LE. */
  startScan(): boolean;
  stopScan(): void;
  connect(id: string): Promise<void>;
  disconnect(): void;
  connectedId(): string | null;
}

/** Undefined until the native app is rebuilt with this module (and on iOS). */
export const HrSensor = requireOptionalNativeModule<HrSensorModule>('HrSensor') ?? undefined;
