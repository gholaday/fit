/**
 * Records (Hevy-style trophies), shared by the run summary, the strength logger and Stats:
 * labels from core, values in the user's units, and one row style. Only events with
 * `celebrate` are shown as new; the first value of a record stays quiet.
 */
import { type LiftRecordKind, type RecordEvent, type UnitPrefs, LIFT_RECORD_LABELS, formatClock, formatDistance, kgToUnit, runRecordLabel } from '@fit/core';
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

export function Trophy({ size = 16 }: { size?: number }) {
  const p = usePalette();
  return <Icons.trophy size={size} color={p.hard.color} />;
}

/** One record: trophy, what it is, the new value and what it was. */
export function RecordRow({ e, units, withExercise, first }: { e: RecordEvent; units: UnitPrefs; withExercise?: boolean; first?: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.row, !first && s.divider]}>
      <Trophy />
      <T v="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
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
