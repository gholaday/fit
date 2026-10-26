/**
 * Native side of recording, imported once at startup (the background task must be defined
 * in the global scope). Location uses expo-location's SDK 58 API (docs/decisions.md):
 *
 * - Pre-start: a foreground position watch, only for the GPS signal readout.
 * - Recording: the location foreground service ("Run in progress") plus background delivery
 *   through a task, so fixes keep arriving with the screen off. AUTOMOTIVE_NAVIGATION is the
 *   only background profile with 1 s fixes, no batching and no distance filter (spec §5);
 *   FITNESS batches for 2 minutes.
 * - Without "Allow all the time" the foreground service still keeps the watch alive, since a
 *   location service started from the foreground keeps while-in-use access.
 *
 * Voice goes through expo-speech, with audio focus requested around each cue so music ducks.
 */
import type { GpsFix } from '@fit/core';
import * as Speech from 'expo-speech';
import {
  defineLocationTask,
  Location,
  LocationProfile,
  LocationUpdatesHandle,
  type Position,
  type PositionWatchHandle,
} from 'expo-location/next';
import { AudioFocus } from '../../../modules/audio-focus';
import { type LocationFeed, services, type Speaker } from './services';

export const LOCATION_TASK = 'fit-run-location';
const PROFILE = LocationProfile.AUTOMOTIVE_NAVIGATION;
const NOTIFICATION_TITLE = 'Run in progress';

let sink: ((fix: GpsFix) => void) | undefined;
/** Fixes that arrived while nothing was listening (the app restarted mid-run); handed to the next sink. */
let orphans: GpsFix[] = [];
let watch: PositionWatchHandle | undefined;
const updates = new LocationUpdatesHandle(LOCATION_TASK).withProfile(PROFILE);
let recording = false;

function toFix(p: Position): GpsFix {
  return {
    t: p.timestamp,
    lat: p.coordinates.latitude,
    lng: p.coordinates.longitude,
    alt: p.altitude ?? undefined,
    accuracy: p.horizontalAccuracy ?? Number.POSITIVE_INFINITY,
    speed: p.speed ?? undefined,
  };
}

function deliver(fix: GpsFix): void {
  if (sink) sink(fix);
  else if (orphans.length < 3600) orphans.push(fix);
}

defineLocationTask({
  taskName: LOCATION_TASK,
  onPosition: (p) => {
    // Background delivery is up: the watch that bridged the handover can go.
    if (watch) stopWatch();
    deliver(toFix(p));
  },
  onError: () => undefined,
});

function setSink(onFix: (fix: GpsFix) => void): void {
  sink = onFix;
  const pending = orphans;
  orphans = [];
  for (const f of pending) onFix(f);
}

function stopWatch(): void {
  watch?.dispose();
  watch = undefined;
}

function startWatch(): void {
  if (watch) return;
  watch = Location.watchPosition({ profile: PROFILE, onPosition: (p) => deliver(toFix(p)) });
}

const location: LocationFeed = {
  async watch(onFix) {
    setSink(onFix);
    const perm = await Location.getForegroundPermissions();
    if (perm.granted) startWatch();
  },

  async record(onFix) {
    setSink(onFix);
    recording = true;
    await Location.ensureBackgroundSessionStarted({ notificationTitle: NOTIFICATION_TITLE, notificationBody: 'Starting' });
    const bg = await Location.getBackgroundPermissions();
    if (bg.granted) {
      // Background delivery replaces the watch once its first fix arrives (see the task), so
      // the handover has no gap. Overlapping fixes share a timestamp and are dropped as stale.
      if (!(await updates.hasStarted())) await updates.start();
    } else {
      startWatch();
    }
  },

  async stop() {
    sink = undefined;
    orphans = [];
    stopWatch();
    if (await updates.hasStarted()) await updates.stop();
    if (recording) await Location.stopBackgroundSession();
    recording = false;
  },

  setStatus(body) {
    if (!recording) return;
    void Location.ensureBackgroundSessionStarted({ notificationTitle: NOTIFICATION_TITLE, notificationBody: body }).catch(() => undefined);
  },
};

let speaking = 0;
function done(): void {
  speaking = Math.max(0, speaking - 1);
  if (speaking === 0) AudioFocus?.release();
}

const speaker: Speaker = {
  speak(text) {
    if (speaking === 0) AudioFocus?.request();
    speaking += 1;
    Speech.speak(text, { onDone: done, onStopped: done, onError: done });
  },
  stop() {
    void Speech.stop();
    speaking = 0;
    AudioFocus?.release();
  },
};

services.location = location;
services.speaker = speaker;
