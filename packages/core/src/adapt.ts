import type { PlanRole } from './agenda';
import { addDays, diffDays, startOfWeek, weekdayOf, type IsoDate } from './dates';
import { isRepeat, type Step, type WorkoutItem } from './workout';

/**
 * Plan adaptation (spec §8 adaptation rules). Pure: give it the plan's workouts and
 * today; it returns actions for the repository to apply and banner messages. Runs on
 * plan open (once a day), after a session is saved, and after a move.
 */

export interface AdaptItem {
  id: string;
  date: IsoDate;
  weekIndex: number;
  role: PlanRole;
  status: 'scheduled' | 'done' | 'missed' | 'skipped' | 'moved';
  hard: boolean;
  name: string;
  /** RPE from "Done + details" or the recorded session, for the easy-run check. */
  rpe?: number;
}

export type AdaptAction =
  | { type: 'missed'; id: string }
  | { type: 'move'; id: string; to: IsoDate }
  /** Next week's long run repeats this week's distance instead of increasing. */
  | { type: 'repeat_long'; fromId: string; toId: string }
  /** Push every workout from this week on by 7 days (repeat a missed week). */
  | { type: 'shift_weeks'; fromWeek: number }
  /** Scale durations of a week's workouts (0.8 after a missed week in a race plan). */
  | { type: 'scale_week'; week: number; factor: number };

export interface AdaptEvent {
  planWorkoutId?: string;
  type: 'moved' | 'dropped' | 'long_held' | 'week_repeated' | 'week_reduced' | 'easy_too_hard';
  message: string;
}

export interface AdaptResult {
  actions: AdaptAction[];
  events: AdaptEvent[];
  /** Two or more whole weeks missed: ask "Rebuild plan from here?" instead of adapting. */
  rebuildPrompt: boolean;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayName = (d: IsoDate) => DAY_NAMES[weekdayOf(d) - 1]!;

export function adaptPlan(input: { today: IsoDate; kind: 'race' | 'fitness'; endDate: IsoDate; items: readonly AdaptItem[] }): AdaptResult {
  const { today } = input;
  const result: AdaptResult = { actions: [], events: [], rebuildPrompt: false };
  const live = input.items.map((i) => ({ ...i }));
  const pending = (i: AdaptItem) => i.status === 'scheduled';

  // Whole weeks missed: every workout of a finished week still pending.
  const weeks = [...new Set(live.map((i) => i.weekIndex))].sort((a, b) => a - b);
  const finished = weeks.filter((w) => live.filter((i) => i.weekIndex === w).every((i) => i.date < startOfWeek(today)));
  let missedRun = 0;
  for (const w of [...finished].reverse()) {
    const inWeek = live.filter((i) => i.weekIndex === w);
    if (inWeek.length > 0 && inWeek.every(pending)) missedRun++;
    else break;
  }
  if (missedRun >= 2) {
    result.rebuildPrompt = true;
    return result;
  }
  if (missedRun === 1) {
    const week = finished.at(-1)!;
    // Repeating needs room: fitness plans can run a week longer; race plans cannot.
    if (input.kind === 'fitness') {
      result.actions.push({ type: 'shift_weeks', fromWeek: week });
      result.events.push({ type: 'week_repeated', message: `Missed week ${week}, so it repeats this week and the plan ends a week later.` });
      // Later rules see the shifted dates, so leftovers from earlier weeks still resolve.
      for (const i of live) if (i.weekIndex >= week && pending(i)) i.date = addDays(i.date, 7);
    } else {
      for (const i of live.filter((x) => x.weekIndex === week)) {
        result.actions.push({ type: 'missed', id: i.id });
        i.status = 'missed';
      }
      if (weeks.includes(week + 1)) {
        result.actions.push({ type: 'scale_week', week: week + 1, factor: 0.8 });
        result.events.push({ type: 'week_reduced', message: `Missed week ${week}, so this week is 20% lighter.` });
      }
    }
  }

  // Single missed workouts, oldest first. Moves only go forward to today or later.
  const occupied = (d: IsoDate) => live.some((i) => i.date === d && i.status !== 'missed' && i.status !== 'skipped');
  const hardOn = (d: IsoDate, except: string) => live.some((i) => i.id !== except && i.date === d && i.hard && i.status !== 'missed' && i.status !== 'skipped');
  const freeFor = (item: AdaptItem, d: IsoDate) => !occupied(d) && d <= input.endDate && (!item.hard || (!hardOn(addDays(d, -1), item.id) && !hardOn(addDays(d, 1), item.id)));

  for (const item of live.filter((i) => pending(i) && i.date < today).sort((a, b) => a.date.localeCompare(b.date))) {
    let to: IsoDate | undefined;
    if (item.role === 'quality' || item.role === 'quality2' || item.role === 'retest') {
      const weekEnd = addDays(startOfWeek(item.date), 6);
      for (let d = today; d <= weekEnd && !to; d = addDays(d, 1)) if (freeFor(item, d)) to = d;
    } else if (item.role === 'long') {
      for (let d = today; diffDays(item.date, d) <= 2 && !to; d = addDays(d, 1)) if (freeFor(item, d)) to = d;
    }

    if (to) {
      result.actions.push({ type: 'move', id: item.id, to });
      result.events.push({ planWorkoutId: item.id, type: 'moved', message: `Moved ${item.name} to ${dayName(to)}.` });
      item.date = to;
      continue;
    }
    result.actions.push({ type: 'missed', id: item.id });
    item.status = 'missed';
    if (item.role === 'long') {
      const next = live.find((i) => i.role === 'long' && i.weekIndex === item.weekIndex + 1 && pending(i));
      if (next) {
        result.actions.push({ type: 'repeat_long', fromId: item.id, toId: next.id });
        result.events.push({ planWorkoutId: next.id, type: 'long_held', message: `Missed the long run, so next week's long run stays at this week's distance.` });
        continue;
      }
    }
    result.events.push({ planWorkoutId: item.id, type: 'dropped', message: `Dropped the missed ${item.name}.` });
  }

  // Easy runs at RPE 9 or more twice in the current or last week: suggest slowing down.
  const since = addDays(startOfWeek(today), -7);
  const hardEasy = live.filter((i) => i.role.startsWith('easy') && i.status === 'done' && (i.rpe ?? 0) >= 9 && i.date >= since);
  if (hardEasy.length >= 2) {
    result.events.push({ type: 'easy_too_hard', message: 'Two easy runs felt very hard. Slow your easy pace until you can talk in full sentences.' });
  }
  return result;
}

/** Scales time and distance durations (rounded to 5 s and 10 m), for scale_week. */
export function scaleItems(items: readonly WorkoutItem[], factor: number): WorkoutItem[] {
  const scale = (s: Step): Step => {
    const d = s.duration;
    if (d.type === 'time') return { ...s, duration: { type: 'time', seconds: Math.max(5, Math.round((d.seconds * factor) / 5) * 5) } };
    if (d.type === 'distance') return { ...s, duration: { type: 'distance', meters: Math.max(10, Math.round((d.meters * factor) / 10) * 10) } };
    return s;
  };
  return items.map((i) => (isRepeat(i) ? { ...i, steps: i.steps.map(scale) } : scale(i)));
}

/**
 * Plan menu "Shift the rest of this week by a day" (spec §8 bigger shifts): pending
 * items from `from` to Sunday move one day later, the Sunday one into next Monday.
 */
export function shiftRestOfWeek(items: readonly Pick<AdaptItem, 'id' | 'date' | 'status'>[], from: IsoDate): { id: string; to: IsoDate }[] {
  const weekEnd = addDays(startOfWeek(from), 6);
  return items
    .filter((i) => i.status === 'scheduled' && i.date >= from && i.date <= weekEnd)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((i) => ({ id: i.id, to: addDays(i.date, 1) }));
}
