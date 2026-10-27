/**
 * What a planned item is, shown in its sheet: a run's structure bar and steps with targets,
 * or a routine's exercises and moves.
 */
import { type AgendaItem, structureSegments } from '@fit/core';
import { useMemo } from 'react';
import { View } from 'react-native';
import { repo } from '@/data';
import { paceLookup } from '@/features/builder/describe';
import { WorkoutSteps } from '@/features/builder/WorkoutSteps';
import { useItemViews } from '@/features/library/RoutineScreen';
import { createStyles } from '@/theme';
import { StructureBar, T } from '@/ui/primitives';

export function WorkoutPreview({ item }: { item: AgendaItem }) {
  return item.source.type === 'schedule' ? <RoutinePreview id={item.refId} /> : <RunPreview id={item.refId} />;
}

function RunPreview({ id }: { id: string }) {
  const s = useStyles();
  const { workout, vdot } = useMemo(() => ({ workout: repo.workout(id), vdot: repo.currentVdot() }), [id]);
  if (!workout || workout.items.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      {workout.items.length > 1 && <StructureBar segments={structureSegments(workout.items, paceLookup(vdot))} height={10} />}
      <WorkoutSteps items={workout.items} vdot={vdot} style={s.card} />
    </View>
  );
}

function RoutinePreview({ id }: { id: string }) {
  const s = useStyles();
  const routine = useMemo(() => repo.routine(id), [id]);
  const items = useItemViews(routine);
  if (items.length === 0) return null;
  return (
    <View style={[s.card, { paddingHorizontal: 14 }]}>
      {items.map((it, i) => (
        <View key={i} style={[s.row, i > 0 && s.divider]}>
          <T v="labelStrong" tone="tertiary" num style={{ width: 20 }}>
            {String(i + 1)}
          </T>
          <View style={{ flex: 1 }}>
            <T v="bodyMedium" numberOfLines={1}>
              {it.name}
            </T>
            {it.line !== '' && (
              <T v="caption" tone="secondary" num>
                {it.line}
              </T>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  // Inside a sheet, which is already the surface color.
  card: { backgroundColor: p.bg, borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
}));
