import type { AgendaItem } from './agenda';
import { addDays, type IsoDate } from './dates';

/**
 * Moving rules (spec §8 "Moving activities"). Moves are always allowed; this only
 * produces warnings and suggestions for the UI. Pure: give it the agenda around the
 * move (at least the source and target weeks) and it tells you what would happen.
 */

export interface MoveWarning {
  type: 'back_to_back_hard';
  /** The hard item that would sit next to a hard item. */
  key: string;
  /** The neighbor it collides with. */
  otherKey: string;
}

export interface MoveEvaluation {
  /** Items of the same lane already on the target day: offer "Swap with X" or "Put both on Thursday". */
  occupants: AgendaItem[];
  /** Warnings if the item is simply added to the target day. */
  warnings: MoveWarning[];
  /** Warnings if swapped with the first occupant instead. */
  swapWarnings: MoveWarning[];
  /** Schedule occurrences ask "Just this time" (default) or "Change the schedule". */
  asksScope: boolean;
  /** One-tap fix for a back-to-back warning: swap with this easier item instead. */
  suggestion?: { type: 'swap'; withKey: string; date: IsoDate };
}

type Placement = Map<string, IsoDate>;

function hardWarnings(items: readonly AgendaItem[], placement: Placement, movedKeys: readonly string[]): MoveWarning[] {
  const dateOf = (i: AgendaItem) => placement.get(i.key) ?? i.date;
  const hard = items.filter((i) => i.hard && i.status !== 'skipped');
  const warnings: MoveWarning[] = [];
  for (const key of movedKeys) {
    const moved = hard.find((i) => i.key === key);
    if (!moved) continue;
    const d = dateOf(moved);
    const neighbors = new Set([addDays(d, -1), d, addDays(d, 1)]);
    for (const other of hard) {
      if (other.key === moved.key) continue;
      if (neighbors.has(dateOf(other))) warnings.push({ type: 'back_to_back_hard', key: moved.key, otherKey: other.key });
    }
  }
  return warnings;
}

export function evaluateMove(items: readonly AgendaItem[], key: string, toDate: IsoDate): MoveEvaluation {
  const item = items.find((i) => i.key === key);
  if (!item) throw new Error(`Unknown agenda item ${key}`);

  const occupants = items.filter((i) => i.key !== key && i.lane === item.lane && i.date === toDate);
  const warnings = hardWarnings(items, new Map([[key, toDate]]), [key]);

  const first = occupants[0];
  const swapWarnings = first
    ? hardWarnings(items, new Map([[key, toDate], [first.key, item.date]]), [key, first.key])
    : [];

  let suggestion: MoveEvaluation['suggestion'];
  if (warnings.length > 0 && item.hard) {
    // Find a pending, non-hard item of the same lane whose day would not put this
    // hard item next to another hard one. Swap with the closest such item to toDate.
    const candidates = items
      .filter((c) => c.key !== key && c.lane === item.lane && !c.hard && c.status === 'pending')
      .filter((c) => hardWarnings(items, new Map([[key, c.date], [c.key, item.date]]), [key]).length === 0)
      .sort((a, b) => Math.abs(dayNum(a.date) - dayNum(toDate)) - Math.abs(dayNum(b.date) - dayNum(toDate)) || a.date.localeCompare(b.date));
    const best = candidates[0];
    if (best) suggestion = { type: 'swap', withKey: best.key, date: best.date };
  }

  return { occupants, warnings, swapWarnings, asksScope: item.source.type === 'schedule', suggestion };
}

function dayNum(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** Hard day definition for plan roles. Strength is never hard (docs/decisions.md). */
export function isHardRole(role: string): boolean {
  return role === 'long' || role === 'quality' || role === 'quality2' || role === 'retest' || role === 'race';
}
