/**
 * Rest timer between sets. Time comes from the end timestamp, so it is right after the
 * app sleeps. At 0 the phone vibrates (foreground) and a scheduled notification fires
 * (background); either way only the banner's text node re-renders while it runs.
 */
import { Vibration } from 'react-native';
import { create } from 'zustand';
import { cancelAlert, scheduleAlert } from '@/lib/alerts';

const ALERT_ID = 'rest-timer';
const PATTERN = [0, 300, 120, 300];

export const useRest = create<{ endsAt?: number; label?: string }>()(() => ({}));

let timer: ReturnType<typeof setTimeout> | undefined;

export function startRest(seconds: number, label?: string): void {
  clearTimeout(timer);
  const endsAt = Date.now() + seconds * 1000;
  const name = label ?? useRest.getState().label;
  useRest.setState({ endsAt, label: name });
  timer = setTimeout(() => {
    Vibration.vibrate(PATTERN);
    // Leave "Go" up briefly, then clear the banner.
    timer = setTimeout(() => useRest.setState({ endsAt: undefined }), 4000);
  }, seconds * 1000);
  void scheduleAlert(ALERT_ID, new Date(endsAt), 'Rest is over', name ? `Next set of ${name}` : 'Next set');
}

export function cancelRest(): void {
  clearTimeout(timer);
  timer = undefined;
  useRest.setState({ endsAt: undefined });
  void cancelAlert(ALERT_ID);
}
