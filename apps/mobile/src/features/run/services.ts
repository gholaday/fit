/**
 * Platform side of a run: voice, cue vibrations and location. The engine only talks to
 * this seam, so it stays free of native modules; `recording.ts` fills it in at startup.
 */
import type { GpsFix, Haptic } from '@fit/core';
import { Vibration } from 'react-native';

// Vibration rather than expo-haptics: it keeps working with the screen off and in a pocket.
const PATTERNS: Record<Haptic, number[]> = {
  // Long, short.
  step: [0, 380, 120, 90],
  // One short pulse per countdown second, so 3-2-1 reads as three pulses.
  countdown: [0, 70],
  // Long.
  finish: [0, 700],
  // One soft pulse: "Back in zone two."
  zone: [0, 120],
};

export const cueHaptic = (h: Haptic): void => Vibration.vibrate(PATTERNS[h]);

export interface LocationFeed {
  /** Foreground fixes for the pre-start signal readout. */
  watch(onFix: (fix: GpsFix) => void): Promise<void>;
  /** Recording: the foreground service and background delivery, so fixes keep coming with the screen off. */
  record(onFix: (fix: GpsFix) => void): Promise<void>;
  stop(): Promise<void>;
  /** Text line of the ongoing "Run in progress" notification. */
  setStatus(body: string): void;
}

export interface Speaker {
  speak(text: string): void;
  stop(): void;
}

export const services: { location?: LocationFeed; speaker?: Speaker } = {};
