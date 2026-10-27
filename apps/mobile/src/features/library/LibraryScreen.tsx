/**
 * Library tab (mockup Library): run workouts, strength workouts and stretch routines
 * (starters included, duplicate to edit), search across them and the exercise catalog, and New.
 */
import { type ExerciseSummary, type Lane, type Routine, TIME_TRIALS, type WorkoutSummary, formatDistance, formatMinutes, parseWorkout, structureSegments, totalSeconds } from '@fit/core';
import { router } from 'expo-router';
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { newId, repo } from '@/data';
import { startTrial, type TimeTrial } from '@/features/pace/paces';
import { useDataVersion, useFit, useRoutines, useUnits, useWorkouts } from '@/data/store';
import { readAt } from '@/lib/focusedVersion';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';
import { Button, LaneTile, StructureBar, T } from '@/ui/primitives';
import { ExerciseRow } from './ExerciseRow';
import { routineDays, routineSub } from './labels';
import { StatusShade } from '@/ui/StatusShade';

export function LibraryScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const routines = useRoutines();
  const schedule = useFit((st) => st.schedule);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDeferredValue(query.trim());

  // The store's version changes on every reload (after seeding or edits), so counts follow.
  const version = useDataVersion();
  const counts = useMemo(() => readAt(version, () => repo.exerciseCounts()), [version]);
  const matches = useMemo<ExerciseSummary[]>(() => readAt(version, () => (q ? repo.exercises({ query: q }).slice(0, 30) : [])), [q, version]);

  const lower = q.toLowerCase();
  const shown = (r: Routine) => !lower || r.name.toLowerCase().includes(lower);
  const strength = routines.filter((r) => r.kind === 'strength' && shown(r));
  const stretch = routines.filter((r) => r.kind === 'stretch' && shown(r));
  const yours = stretch.filter((r) => r.origin === 'custom').length;
  const runs = useWorkouts().filter((w) => !lower || w.name.toLowerCase().includes(lower));
  const trials = TIME_TRIALS.filter((t) => !lower || t.name.toLowerCase().includes(lower));

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.head}>
          <T v="display" accessibilityRole="header">
            Library
          </T>
          <Button label="New" size="sm" icon={<Icons.plus size={14} color={p.onPrimary} />} onPress={() => setCreating(true)} />
        </View>

        <View style={s.search}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search workouts, routines, exercises"
            placeholderTextColor={p.textTertiary}
            accessibilityLabel="Search the library"
            returnKeyType="search"
            style={s.searchInput}
          />
          {query !== '' && (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}>
              <Icons.x size={16} color={p.textSecondary} />
            </Pressable>
          )}
        </View>

        <Section title="Runs" meta={trials.length > 0 ? `${runs.length} yours, ${trials.length} time trials` : String(runs.length)}>
          {runs.map((w) => (
            <RunRow key={w.id} workout={w} />
          ))}
          {runs.length === 0 && !q && <Empty text="No run workouts yet. Tap New to build one." />}
          {trials.map((t) => (
            <TrialRow key={t.id} trial={t} />
          ))}
        </Section>

        <Section title="Workouts" meta={String(strength.length)}>
          {strength.map((r) => (
            <RoutineRow key={r.id} routine={r} days={routineDays(r.id, schedule)} />
          ))}
          {strength.length === 0 && !q && <Empty text="No workouts yet. Tap New to make one." />}
        </Section>

        <Section title="Stretch routines" meta={`${yours} yours, ${stretch.length - yours} starters`}>
          {stretch.map((r) => (
            <RoutineRow key={r.id} routine={r} days={routineDays(r.id, schedule)} />
          ))}
        </Section>

        {q ? (
          <Section title="Exercises" meta={matches.length === 30 ? 'Top 30' : String(matches.length)}>
            {matches.map((e) => (
              <ExerciseRow key={e.id} exercise={e} onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: e.id } })} />
            ))}
            {matches.length === 0 && <Empty text="No exercises match" />}
          </Section>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              haptic.tap();
              router.push('/exercises');
            }}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
          >
            <View style={[s.tile, { backgroundColor: p.inset }]}>
              <Icons.listDetails size={18} color={p.text} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Exercises</T>
              <T v="caption" tone="secondary">{`${counts.total - counts.custom} in the catalog, ${counts.custom} custom`}</T>
            </View>
            <Icons.chevronRight size={18} color={p.textTertiary} />
          </Pressable>
        )}
      </ScrollView>
      <StatusShade />

      <Sheet visible={creating} onClose={() => setCreating(false)} title="New">
        <View style={{ gap: 8 }}>
          <NewOption title="Run workout" sub="Steps with time or distance and a target each" lane="run" onPress={() => go(setCreating, '/workout/edit')} />
          <NewOption title="Workout" sub="Strength exercises with sets, reps and weight" lane="workout" onPress={() => go(setCreating, { pathname: '/routine/edit', params: { kind: 'strength' } })} />
          <NewOption title="Stretch routine" sub="Moves with hold times, guided" lane="stretch" onPress={() => go(setCreating, { pathname: '/routine/edit', params: { kind: 'stretch' } })} />
          <NewOption title="Exercise" sub="Add one the catalog does not have" lane="workout" onPress={() => go(setCreating, '/exercise/new')} />
        </View>
      </Sheet>
    </View>
  );
}

function go(close: (v: boolean) => void, href: Parameters<typeof router.push>[0]) {
  close(false);
  router.push(href);
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T v="headline" accessibilityRole="header">
          {title}
        </T>
        {meta ? (
          <T v="caption" tone="secondary">
            {meta}
          </T>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <T v="caption" tone="tertiary" style={{ paddingVertical: 8 }}>
      {text}
    </T>
  );
}

const RoutineRow = memo(function RoutineRow({ routine, days }: { routine: Routine; days: string }) {
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptic.tap();
        router.push({ pathname: '/routine/[id]', params: { id: routine.id } });
      }}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <LaneTile lane={routine.kind === 'strength' ? 'workout' : 'stretch'} size={34} />
      <View style={{ flex: 1 }}>
        <T v="bodyStrong" numberOfLines={1}>
          {routine.name}
        </T>
        <T v="caption" tone="secondary" numberOfLines={1}>
          {routine.origin === 'starter' ? `${routineSub(routine)}, starter` : routineSub(routine)}
        </T>
      </View>
      {days ? (
        <T v="caption" tone="secondary">
          {days}
        </T>
      ) : null}
    </Pressable>
  );
});

const RunRow = memo(function RunRow({ workout: w }: { workout: WorkoutSummary }) {
  const s = useStyles();
  const unit = useUnits().distance;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptic.tap();
        router.push({ pathname: '/workout/[id]', params: { id: w.id } });
      }}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <LaneTile lane="run" size={34} />
      <View style={{ flex: 1, gap: 4 }}>
        <T v="bodyStrong" numberOfLines={1}>
          {w.name}
        </T>
        <T v="caption" tone="secondary" numberOfLines={1} num>
          {w.estMeters > 0 ? `${formatMinutes(w.estSeconds)}, about ${formatDistance(w.estMeters, unit)}` : formatMinutes(w.estSeconds)}
        </T>
        <StructureBar segments={w.structure} height={4} />
      </View>
    </Pressable>
  );
});

/** Built-in time trials: read-only, Start only. They set your paces when you finish. */
const TrialRow = memo(function TrialRow({ trial }: { trial: TimeTrial }) {
  const s = useStyles();
  const p = usePalette();
  // Parsed once for the estimate and the bar; the start parses again with fresh ids.
  const [items] = useState(() => parseWorkout(trial.dsl, newId));
  return (
    <View style={s.row}>
      <LaneTile lane="run" size={34} />
      <View style={{ flex: 1, gap: 4 }}>
        <T v="bodyStrong" numberOfLines={1}>
          {trial.name}
        </T>
        <T v="caption" tone="secondary" numberOfLines={1}>{`About ${formatMinutes(totalSeconds(items))}, sets your paces`}</T>
        <StructureBar segments={structureSegments(items)} height={4} />
      </View>
      <Button label="Start" size="sm" kind="outline" icon={<Icons.play size={12} color={p.text} />} onPress={() => startTrial(trial)} />
    </View>
  );
});

function NewOption({ title, sub, lane, onPress }: { title: string; sub: string; lane: Lane; onPress: () => void }) {
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [s.option, pressed && { opacity: 0.7 }]}
    >
      <LaneTile lane={lane} />
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{title}</T>
        <T v="caption" tone="secondary">
          {sub}
        </T>
      </View>
    </Pressable>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 18 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  search: { height: 44, borderRadius: 12, backgroundColor: p.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: p.text, fontFamily: 'Inter', fontSize: 15, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.surface, minHeight: 56 },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: p.inset },
}));
