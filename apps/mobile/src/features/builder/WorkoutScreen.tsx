/**
 * A run workout in the library: its structure, steps and estimates, with Start (the usual
 * pre-start with this workout), Edit, Duplicate and Delete.
 */
import { formatDistance, formatMinutes, structureSegments, totalMeters, totalSeconds } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack, useUnits, useWorkouts } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';
import { Button, IconButton, StructureBar, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { paceLookup } from './describe';
import { WorkoutSteps } from './WorkoutSteps';

const MODE_LABEL = { outdoor: 'Outdoor', treadmill: 'Treadmill', timer: 'Timer' } as const;

export function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const unit = useUnits().distance;
  // Re-read after edits: the library row changes when the workout is saved.
  const row = useWorkouts().find((w) => w.id === id);
  const workout = repo.workout(id);
  const [vdot] = useState(() => repo.currentVdot());
  const [deleting, setDeleting] = useState(false);

  if (!workout) {
    return (
      <View style={[s.screen, s.center]}>
        <T v="bodyMedium" tone="secondary">
          Workout not found
        </T>
        <Button label="Back" kind="outline" size="sm" onPress={() => router.back()} />
      </View>
    );
  }

  const pace = paceLookup(vdot);
  const meters = totalMeters(workout.items, pace);
  const start = () => {
    haptic.commit();
    router.push({ pathname: '/run', params: { workoutId: workout.id } });
  };
  const duplicate = () => {
    const copy = repo.duplicateWorkout(workout.id, `${workout.name} copy`);
    actions.reload();
    haptic.success();
    showSnack({ message: 'Workout duplicated' });
    router.replace({ pathname: '/workout/[id]', params: { id: copy } });
  };
  const remove = () => {
    repo.deleteWorkout(workout.id);
    actions.reload();
    haptic.commit();
    setDeleting(false);
    showSnack({ message: `${workout.name} deleted` });
    router.back();
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <View style={{ flex: 1 }} />
          <Button label="Edit" kind="outline" size="sm" style={{ borderRadius: 18 }} onPress={() => router.push({ pathname: '/workout/edit', params: { id: workout.id } })} />
        </View>

        <View style={{ gap: 6 }}>
          <T v="title">{workout.name}</T>
          <T v="label" tone="secondary" num>
            {[MODE_LABEL[workout.defaultMode], formatMinutes(row?.estSeconds ?? totalSeconds(workout.items, pace)), meters > 0 ? `about ${formatDistance(meters, unit)}` : undefined].filter(Boolean).join(', ')}
          </T>
        </View>
        <StructureBar segments={structureSegments(workout.items, pace)} height={12} />

        <WorkoutSteps items={workout.items} vdot={vdot} />

        <View style={{ gap: 8 }}>
          <Button label="Duplicate" kind="outline" size="md" onPress={duplicate} />
          <Button label="Delete" kind="quiet" size="md" onPress={() => setDeleting(true)} />
        </View>
      </ScrollView>
      <StatusShade />
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Start" icon={<Icons.play size={16} color={p.onPrimary} />} onPress={start} />
      </View>

      <Sheet visible={deleting} onClose={() => setDeleting(false)} title={`Delete ${workout.name}?`}>
        <View style={{ gap: 8 }}>
          <T v="body" tone="secondary">
            Runs you already recorded with it keep their steps.
          </T>
          <Button label="Delete" onPress={remove} />
          <Button label="Keep it" kind="outline" onPress={() => setDeleting(false)} />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
}));
