/**
 * Routine reminders: one weekly notification per schedule entry that has a time and
 * the reminder on ("Evening stretch", "7 moves, 9 min"). Synced from the store whenever
 * the schedule or routines change; ids are stable so unchanged reminders are left alone.
 */
import type { Routine, ScheduleEntry } from '@fit/core';
import { useFit } from '@/data/store';
import { cancelAlert, scheduledIds, scheduleWeekly } from '@/lib/alerts';
import { routineSub } from './labels';

const PREFIX = 'reminder:';

interface Wanted {
  weekday: number;
  hour: number;
  minute: number;
  title: string;
  body: string;
}

function wanted(schedule: readonly ScheduleEntry[], routines: readonly Routine[]): Map<string, Wanted> {
  const byId = new Map(routines.map((r) => [r.id, r]));
  const out = new Map<string, Wanted>();
  for (const e of schedule) {
    const routine = byId.get(e.routineId);
    // Optimistic entries get a real id on the next reload; sync then.
    if (!e.reminder || !e.time || !routine || e.id.startsWith('pending_')) continue;
    const [hour, minute] = e.time.split(':').map(Number);
    out.set(`${PREFIX}${e.id}`, { weekday: e.weekday, hour: hour!, minute: minute!, title: routine.name, body: routineSub(routine) });
  }
  return out;
}

let applied = new Map<string, string>();
let running: Promise<void> = Promise.resolve();

async function sync(next: Map<string, Wanted>): Promise<void> {
  const scheduled = new Set((await scheduledIds()).filter((id) => id.startsWith(PREFIX)));
  for (const id of scheduled) if (!next.has(id)) await cancelAlert(id);
  const done = new Map<string, string>();
  for (const [id, w] of next) {
    const print = JSON.stringify(w);
    if (!(scheduled.has(id) && applied.get(id) === print)) await scheduleWeekly(id, w.weekday, w.hour, w.minute, w.title, w.body);
    done.set(id, print);
  }
  applied = done;
}

/** Start syncing; returns the unsubscribe. */
export function startReminderSync(): () => void {
  const run = () => {
    const { schedule, routines } = useFit.getState();
    const next = wanted(schedule, routines);
    running = running.then(() => sync(next)).catch(() => undefined);
  };
  run();
  return useFit.subscribe((s, prev) => {
    if (s.schedule !== prev.schedule || s.routines !== prev.routines) run();
  });
}
