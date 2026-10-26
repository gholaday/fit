/**
 * Health Connect data the screens show (spec §11): today's metrics, the last sync time and
 * watch sessions waiting for the new-activity modal. Read from the repository; the sync
 * (and every modal action) calls reloadHealth() afterwards.
 */
import { type DailyMetrics, type ExternalSession, localIsoDate } from '@fit/core';
import { create } from 'zustand';
import { repo } from '@/data';

interface HealthState {
  metrics?: DailyMetrics;
  lastSyncedAt?: string;
  pending: ExternalSession[];
  /** The new-activity modal is open. "Later" closes it until the Today chip reopens it. */
  modalOpen: boolean;
  /** Saved or ignored since the modal opened, for "2 of 3". */
  handled: number;
}

export const useHealth = create<HealthState>()(() => ({ pending: [], modalOpen: false, handled: 0 }));

export function reloadHealth(): void {
  const pending = repo.pendingExternal();
  useHealth.setState((s) => ({
    metrics: repo.dailyMetrics(localIsoDate(new Date())),
    lastSyncedAt: repo.healthSyncState().lastSyncedAt,
    pending,
    modalOpen: s.modalOpen && pending.length > 0,
  }));
}

/** Opens the modal when there is something to show. */
export function openActivities(): void {
  if (useHealth.getState().pending.length > 0) useHealth.setState({ modalOpen: true, handled: 0 });
}

export function closeActivities(): void {
  useHealth.setState({ modalOpen: false });
}

export function markHandled(): void {
  useHealth.setState((s) => ({ handled: s.handled + 1 }));
}

/** "9:41 AM" today, "Oct 25, 9:41 AM" before. */
export function syncedLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  if (localIsoDate(d) === localIsoDate(new Date())) return time;
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getDate()}, ${time}`;
}
