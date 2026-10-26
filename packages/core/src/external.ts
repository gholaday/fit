import type { AgendaItem, Lane } from './agenda';
import { diffDays, localIsoDate, type IsoDate } from './dates';

/**
 * Workouts recorded on the watch and read from Health Connect (spec §11). A watch run that
 * overlaps a phone session is merged into it (HR only); anything else becomes an external
 * session that the new-activity modal links to the plan or saves as unplanned.
 */

export type ExternalActivity = 'run' | 'treadmill' | 'walk' | 'hike' | 'bike' | 'swim' | 'strength' | 'stretch' | 'other';

export interface TimeWindow {
  /** Epoch ms. */
  startMs: number;
  endMs: number;
}

/** Share of `ext`'s duration covered by `other`. */
export function overlapFraction(ext: TimeWindow, other: TimeWindow): number {
  const dur = ext.endMs - ext.startMs;
  if (dur <= 0) return 0;
  const shared = Math.min(ext.endMs, other.endMs) - Math.max(ext.startMs, other.startMs);
  return Math.max(0, shared) / dur;
}

/** The phone session to merge into: the one covering more than half the watch session. */
export function findMergeTarget<T extends TimeWindow>(ext: TimeWindow, sessions: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestFrac = 0.5;
  for (const s of sessions) {
    const f = overlapFraction(ext, s);
    if (f > bestFrac) {
      best = s;
      bestFrac = f;
    }
  }
  return best;
}

const LANE_FOR: Record<ExternalActivity, Lane | undefined> = {
  run: 'run',
  treadmill: 'run',
  walk: 'run',
  hike: 'run',
  bike: undefined,
  swim: undefined,
  strength: 'workout',
  stretch: 'stretch',
  other: undefined,
};

export interface PlanMatch {
  /** Best match, pre-selected in the modal. */
  suggested?: AgendaItem;
  /** Pending (or done without data) items from the last 3 days or tomorrow, most likely first. */
  candidates: AgendaItem[];
}

/**
 * Plan match for the new-activity modal: same lane, within a day, duration within 30%.
 * Items already done with a session attached are never offered; items done by hand are,
 * so the modal can say "Attach to the completed ...".
 */
export function matchPlanItem(ext: TimeWindow & { activity: ExternalActivity }, agenda: readonly AgendaItem[]): PlanMatch {
  const day: IsoDate = localIsoDate(new Date(ext.startMs));
  const minutes = (ext.endMs - ext.startMs) / 60000;
  const lane = LANE_FOR[ext.activity];
  const open = agenda.filter((a) => a.status !== 'skipped' && !a.sessionId && !a.externalSessionId && diffDays(a.date, day) >= -1 && diffDays(a.date, day) <= 3);
  const score = (a: AgendaItem) => {
    const estMin = a.estSeconds / 60;
    return Math.abs(diffDays(a.date, day)) * 10 + (estMin > 0 ? Math.abs(minutes - estMin) / estMin : 1) + (a.status === 'done' ? 0.5 : 0);
  };
  const candidates = [...open].sort((a, b) => Number(b.lane === lane) - Number(a.lane === lane) || score(a) - score(b));
  const strong = candidates.filter((a) => {
    if (a.lane !== lane || Math.abs(diffDays(a.date, day)) > 1) return false;
    const estMin = a.estSeconds / 60;
    return estMin > 0 && Math.abs(minutes - estMin) / estMin <= 0.3;
  });
  const suggested = strong[0];
  if (!suggested) return { candidates };
  return { suggested, candidates: [suggested, ...candidates.filter((c) => c !== suggested)] };
}
