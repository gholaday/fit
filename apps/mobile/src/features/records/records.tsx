/**
 * Records (Hevy-style trophies), shared by the run summary, the strength logger and Stats:
 * labels from core, values in the user's units, and one row style. Only events with
 * `celebrate` are shown as new; the first value of a record stays quiet.
 */
import {
  type IsoDate,
  type LiftBests,
  type LiftRecordKind,
  type LoggedSet,
  type RecordEvent,
  type UnitPrefs,
  LIFT_RECORD_LABELS,
  formatClock,
  formatDistance,
  kgToUnit,
  oneRepMax,
  runRecordLabel,
  setRecords,
} from '@fit/core';
import { View } from 'react-native';
import { repo } from '@/data';
import { thousands } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';

/** "5 km", "Longest run", or "Bench press, heaviest weight" with `withExercise`. */
export function recordLabel(e: RecordEvent, withExercise = false): string {
  if (e.group === 'run') return runRecordLabel(e);
  const label = LIFT_RECORD_LABELS[e.kind as LiftRecordKind];
  if (!withExercise || !e.exerciseId) return label;
  const name = repo.exercise(e.exerciseId)?.name ?? 'Exercise';
  return `${name}, ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** A record's value in display units: "24:12", "6.21 mi", "140 lb", "12 reps". */
export function recordValue(e: Pick<RecordEvent, 'group' | 'kind' | 'value'>, units: UnitPrefs): string {
  const v = e.value;
  switch (e.kind) {
    case 'effort':
    case 'longest_time':
    case 'longest_nonstop':
    case 'first_hour':
      return formatClock(Math.round(v));
    case 'longest_distance':
    case 'biggest_week':
    case 'first_distance':
      return formatDistance(v, units.distance, 2);
    case 'heaviest':
    case 'one_rep_max':
      return `${Math.round(kgToUnit(v, units.weight) * 10) / 10} ${units.weight}`;
    case 'set_volume':
    case 'session_volume':
      return `${thousands(Math.round(kgToUnit(v, units.weight)))} ${units.weight}`;
    case 'most_reps':
      return `${v} reps`;
    case 'longest_hold':
      return `${Math.round(v)} s`;
    default:
      return String(v);
  }
}

/** Standing lift bests by exercise id, as `repo.liftBests` returns them. */
export type Bests = Record<string, LiftBests>;
type CheckedSet = Pick<LoggedSet, 'exerciseId' | 'reps' | 'weightKg' | 'durationS'>;

/** What a set counts as toward each set record, measured the way core measures it. */
function setValues(set: CheckedSet): LiftBests {
  const w = set.weightKg ?? 0;
  if (w > 0 && set.reps > 0) {
    const orm = oneRepMax(w, set.reps);
    return { heaviest: w, set_volume: Math.round(w * set.reps * 10) / 10, ...(orm !== undefined ? { one_rep_max: orm } : {}) };
  }
  if ((set.durationS ?? 0) > 0) return { longest_hold: set.durationS! };
  return set.reps > 0 ? { most_reps: set.reps } : {};
}

/**
 * Replays checked sets in the order given against the bests from before the session, so a
 * second set only gets a trophy if it beats the first. Returns the records each set beat
 * and the bests after the last set.
 */
export function replaySets<S extends CheckedSet>(sets: readonly S[], before: Bests): { beaten: Map<S, LiftRecordKind[]>; after: Bests } {
  const after: Bests = {};
  const beaten = new Map<S, LiftRecordKind[]>();
  for (const set of sets) {
    const running = (after[set.exerciseId] ??= { ...before[set.exerciseId] });
    const kinds = setRecords(set, running);
    if (kinds.length === 0) continue;
    beaten.set(set, kinds);
    const values = setValues(set);
    for (const k of kinds) running[k] = values[k];
  }
  return { beaten, after };
}

const SET_KINDS: LiftRecordKind[] = ['heaviest', 'one_rep_max', 'set_volume', 'most_reps', 'longest_hold'];

/** The records a finished workout beat, before it is saved: set records plus session volume. */
export function workoutRecords(sets: readonly LoggedSet[], before: Bests, date: IsoDate): RecordEvent[] {
  const { beaten, after } = replaySets(sets, before);
  const out: RecordEvent[] = [];
  for (const id of new Set(sets.map((s) => s.exerciseId))) {
    const prev = before[id] ?? {};
    const event = (kind: LiftRecordKind, value: number, previous: number): RecordEvent => ({ key: `lift:${id}:${kind}`, group: 'lift', kind, exerciseId: id, value, previous, sessionId: '', date, celebrate: true });
    const kinds = new Set([...beaten].filter(([s]) => s.exerciseId === id).flatMap(([, k]) => k));
    for (const kind of SET_KINDS) if (kinds.has(kind)) out.push(event(kind, after[id]![kind]!, prev[kind]!));
    const volume = Math.round(sets.reduce((sum, s) => (s.exerciseId === id && (s.weightKg ?? 0) > 0 ? sum + s.weightKg! * s.reps : sum), 0) * 10) / 10;
    if (prev.session_volume !== undefined && volume > prev.session_volume) out.push(event('session_volume', volume, prev.session_volume));
  }
  return out;
}

export function Trophy({ size = 16 }: { size?: number }) {
  const p = usePalette();
  return <Icons.trophy size={size} color={p.trophy} />;
}

/** One record: trophy, what it is, the new value and what it was. */
export function RecordRow({ e, units, withExercise, first }: { e: RecordEvent; units: UnitPrefs; withExercise?: boolean; first?: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.row, !first && s.divider]}>
      <Trophy />
      <T v="bodyMedium" style={{ flex: 1 }} numberOfLines={2}>
        {recordLabel(e, withExercise)}
      </T>
      <View style={{ alignItems: 'flex-end' }}>
        <T v="bodyStrong" num>
          {recordValue(e, units)}
        </T>
        {e.previous !== undefined && (
          <T v="caption" tone="secondary" num>
            {`was ${recordValue({ ...e, value: e.previous }, units)}`}
          </T>
        )}
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
}));
