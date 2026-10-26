/**
 * The move flow shared by drag and drop, the day picker and "Move to tomorrow".
 * All rules come from @fit/core `evaluateMove`; this file only sequences the prompts
 * (occupied day, then "Just this time" or "Change the schedule") and the feedback
 * (Undo snackbar, back-to-back note with the one-tap swap).
 */
import { type AgendaItem, type IsoDate, type MoveEvaluation, type MoveScope, type Weekday, evaluateMove, weekdayOf } from '@fit/core';
import { create } from 'zustand';
import { actions, getItems, showSnack, useFit } from '@/data/store';
import { dayName } from '@/features/items/meta';
import { weekdayLong } from '@/lib/format';

export type MoveStep = 'occupied' | 'scope';

interface Pending {
  key: string;
  toDate: IsoDate;
  step: MoveStep;
  evaluation: MoveEvaluation;
}

export const useMoveFlow = create<{ pending: Pending | undefined }>()(() => ({ pending: undefined }));

export function evaluate(key: string, toDate: IsoDate): MoveEvaluation {
  const s = useFit.getState();
  return evaluateMove(getItems(s.windowStart, s.windowEnd), key, toDate);
}

/** Start a move. Applies immediately when no question needs asking. */
export function startMove(key: string, toDate: IsoDate): void {
  const item = useFit.getState().items[key];
  if (!item || item.date === toDate) return;
  actions.ensureRange(toDate, toDate);
  const evaluation = evaluate(key, toDate);
  if (evaluation.occupants.length > 0) useMoveFlow.setState({ pending: { key, toDate, step: 'occupied', evaluation } });
  else if (evaluation.asksScope) useMoveFlow.setState({ pending: { key, toDate, step: 'scope', evaluation } });
  else commitMove(item, toDate, 'once', evaluation);
}

export function cancelMove(): void {
  useMoveFlow.setState({ pending: undefined });
}

/** "Put both on Thursday": add to the day, then ask scope if it is a schedule item. */
export function putBoth(): void {
  const p = useMoveFlow.getState().pending;
  if (!p) return;
  const item = useFit.getState().items[p.key];
  if (!item) return cancelMove();
  if (p.evaluation.asksScope) useMoveFlow.setState({ pending: { ...p, step: 'scope' } });
  else {
    cancelMove();
    commitMove(item, p.toDate, 'once', p.evaluation);
  }
}

/** "Swap with Tempo Run". A swap only ever affects these two occurrences. */
export function swapWithOccupant(): void {
  const p = useMoveFlow.getState().pending;
  cancelMove();
  if (!p) return;
  const s = useFit.getState();
  const item = s.items[p.key];
  const other = p.evaluation.occupants[0];
  if (!item || !other) return;
  actions.swap(item.key, other.key);
  feedback(`Swapped ${item.title} and ${other.title}`, () => actions.swap(item.key, other.key), item, p.evaluation.swapWarnings.length > 0, p.evaluation);
}

export function chooseScope(scope: MoveScope): void {
  const p = useMoveFlow.getState().pending;
  cancelMove();
  if (!p) return;
  const item = useFit.getState().items[p.key];
  if (item) commitMove(item, p.toDate, scope, p.evaluation);
}

function commitMove(item: AgendaItem, toDate: IsoDate, scope: MoveScope, evaluation: MoveEvaluation): void {
  const today = useFit.getState().today;
  const fromDate = item.date;
  if (scope === 'schedule' && item.source.type === 'schedule') {
    const scheduleId = item.source.scheduleId;
    const oldWeekday: Weekday = weekdayOf(item.originalDate);
    actions.move(item.key, toDate, 'schedule');
    const undo = () => actions.updateScheduleEntry(scheduleId, { weekday: oldWeekday });
    showSnack({ message: `${item.title} moved to ${weekdayLong(weekdayOf(toDate))}s`, actionLabel: 'Undo', onAction: undo });
    return;
  }
  actions.move(item.key, toDate, 'once');
  const undo = () => actions.move(item.key, fromDate, 'once');
  feedback(`Moved ${item.title} to ${dayName(toDate, today)}`, undo, item, evaluation.warnings.length > 0, evaluation);
}

function feedback(message: string, undo: () => void, item: AgendaItem, warn: boolean, evaluation: MoveEvaluation): void {
  if (!warn) {
    showSnack({ message, actionLabel: 'Undo', onAction: undo });
    return;
  }
  const s = useFit.getState();
  const suggestion = evaluation.suggestion;
  const other = suggestion ? s.items[suggestion.withKey] : undefined;
  showSnack({
    message,
    actionLabel: 'Undo',
    onAction: undo,
    note: 'Back-to-back hard days',
    noteActionLabel: other ? `Swap with ${other.title}` : undefined,
    onNoteAction: other
      ? () => {
          undo();
          actions.swap(item.key, other.key);
          showSnack({ message: `Swapped ${item.title} and ${other.title}`, actionLabel: 'Undo', onAction: () => actions.swap(item.key, other.key) });
        }
      : undefined,
  });
}
